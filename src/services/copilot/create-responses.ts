import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    "X-Initiator": "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesResponse
}

// Payload types

export interface ResponsesInputMessage {
  role: "system" | "user" | "assistant" | "developer"
  content: string | Array<ResponsesContentPart>
}

export interface ResponsesContentPart {
  type: string
  text?: string
  [key: string]: unknown
}

export interface ResponsesTool {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  type: "function"
  strict?: boolean
}

export interface ResponsesReasoning {
  effort?: "low" | "medium" | "high" | "xhigh"
  summary?: "auto" | "detailed" | "none"
}

export interface ResponsesPayload {
  model: string
  input: Array<ResponsesInputMessage> | string
  stream?: boolean
  tools?: Array<ResponsesTool>
  max_output_tokens?: number
  store?: boolean
  truncation?: string
  reasoning?: ResponsesReasoning
  include?: Array<string>
  temperature?: number
  top_p?: number
  [key: string]: unknown
}

// Response types

export interface ResponsesResponse {
  id: string
  object: string
  model: string
  output: Array<Record<string, unknown>>
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  [key: string]: unknown
}
