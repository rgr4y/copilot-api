import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    const openaiModels = state.models?.data.map((model) => ({
      id: model.id,
      object: "model",
      type: "model",
      created: 0,
      created_at: new Date(0).toISOString(),
      owned_by: model.vendor,
      display_name: model.name,
    }))

    const codexModels = state.models?.data.map((model) => ({
      slug: model.id,
      display_name: model.name,
      description: "",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "low", description: "Fast responses" },
        { effort: "medium", description: "Balanced" },
        { effort: "high", description: "Deep reasoning" },
        { effort: "xhigh", description: "Maximum reasoning" },
      ],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: 0,
      additional_speed_tiers: [],
      availability_nux: null,
      upgrade: null,
    }))

    return c.json({
      object: "list",
      data: openaiModels,
      models: codexModels,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
