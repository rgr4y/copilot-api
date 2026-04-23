import consola from "consola"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { state } from "~/lib/state"

export function handleResponsesWsUpgrade(
  req: Request,
  bunServer: { upgrade: (req: Request, opts?: object) => boolean },
): boolean {
  if (!state.copilotToken) {
    consola.error("WS upgrade rejected: no Copilot token")
    return false
  }

  return bunServer.upgrade(req, {
    data: { type: "responses-proxy" },
  })
}

export function isResponsesWsPath(url: string): boolean {
  const path = new URL(url).pathname
  return path === "/v1/responses" || path === "/responses"
}

const UNSUPPORTED_TOOL_TYPES = new Set(["image_generation"])

function unwrapPayload(raw: Record<string, unknown>): Record<string, unknown> {
  let payload: Record<string, unknown>
  if (raw.type === "response.create") {
    if (typeof raw.response === "object" && raw.response !== null) {
      payload = { ...(raw.response as Record<string, unknown>) }
    } else {
      const { type: _, ...rest } = raw
      payload = rest
    }
  } else {
    payload = { ...raw }
  }

  if (Array.isArray(payload.tools)) {
    payload.tools = (payload.tools as any[]).filter(
      (t) => !UNSUPPORTED_TOOL_TYPES.has(t.type),
    )
  }

  payload.stream = true
  return payload
}

async function handleRequest(ws: any, raw: Record<string, unknown>) {
  const headers: Record<string, string> = {
    ...copilotHeaders(state),
  }

  const url = `${copilotBaseUrl(state)}/responses`
  const body = unwrapPayload(raw)

  consola.debug("WS→HTTP POST:", url, "keys:", Object.keys(body).join(","))

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    consola.debug("Upstream status:", response.status, "content-type:", response.headers.get("content-type"))

    if (!response.ok) {
      const errText = await response.text()
      consola.error("Upstream error:", response.status, errText)
      ws.send(JSON.stringify({
        type: "error",
        error: { message: errText, code: response.status },
      }))
      return
    }

    if (!response.body) {
      consola.error("No response body from upstream")
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let currentEventType = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim()
          continue
        }
        if (line.startsWith("data: ")) {
          const data = line.slice(6)
          if (data === "[DONE]") {
            consola.debug("SSE stream done")
            continue
          }

          let toSend = data
          if (currentEventType) {
            try {
              const parsed = JSON.parse(data)
              if (!parsed.type) {
                parsed.type = currentEventType
                toSend = JSON.stringify(parsed)
              }
            } catch {}
          }

          consola.debug("Relaying SSE→WS:", toSend.slice(0, 150))
          try {
            ws.send(toSend)
          } catch (e) {
            consola.error("WS send failed:", e)
            return
          }
          currentEventType = ""
        }
      }
    }
  } catch (e) {
    consola.error("HTTP request failed:", e)
    try {
      ws.send(JSON.stringify({
        type: "error",
        error: { message: (e as Error).message },
      }))
    } catch {}
  }
}

export const responsesWebSocket = {
  open(ws: any) {
    consola.debug("Client WS opened")
  },

  message(ws: any, message: string | Buffer) {
    const data = typeof message === "string" ? message : message.toString()
    consola.debug("Client WS msg:", data.slice(0, 300))

    try {
      const parsed = JSON.parse(data)
      handleRequest(ws, parsed)
    } catch (e) {
      consola.error("Bad JSON from client:", e)
      ws.send(JSON.stringify({ type: "error", error: { message: "Invalid JSON" } }))
    }
  },

  close(ws: any, code: number, reason: string) {
    consola.debug("Client WS closed:", code, reason)
  },
}
