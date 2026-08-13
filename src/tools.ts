/** Focused model-facing Computer Use Tool definitions. */

import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type JsonValue, type ToolDefinition, type ToolRunContext, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  ComputerConfirmationToken,
  ComputerObservationId,
  type ComputerActionRequest,
  type ComputerArtifact,
  type ComputerUseContext,
} from './types.ts'
import type { ComputerUseService } from './service.ts'

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function contextOf(exec: ToolRunContext): ComputerUseContext {
  const agent = exec.agent
  if (agent === undefined) throw new Error(`${exec.name}: an Agent Session is required`)
  return {
    agent,
    workspace: agent.session.header.cwd ?? process.cwd(),
    callId: exec.callId,
    signal: exec.signal,
  }
}

function deferVisionHandoff(exec: ToolRunContext, artifact: ComputerArtifact | undefined): void {
  if (artifact === undefined) return
  exec.deferContext(createUserMessage({
    content: [{
      type: 'text',
      text: [
        `Computer Use returned a screenshot Artifact at ${JSON.stringify(artifact.path)}.`,
        'If the task now needs OCR, visual grounding, or pixel inspection and vision_glance is not visible, call the skill tool with {"name":"vision-tools"}; then pass this exact Artifact path to vision_glance, vision_ground, vision_detect, vision_crop, or vision_long_screenshot_ocr.',
        'Do not inspect OCR executables or use bash, tesseract, screencapture, or an ad hoc Swift/Python OCR implementation.',
      ].join(' '),
    }],
    source: { kind: 'plugin', plugin: 'dsh-computer-use' },
  }))
}

const rectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
  },
} as const satisfies ValueSchemaSpec

const appSelectorSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bundleId: { type: 'string', description: 'Preferred exact macOS bundle identifier.' },
    pid: { type: 'integer', description: 'Exact current process id when already observed.' },
    name: { type: 'string', description: 'Display name accepted only when it resolves uniquely.' },
  },
} as const satisfies ValueSchemaSpec

const appSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bundleId: { type: 'string', required: true },
    pid: { type: 'integer', required: true },
    name: { type: 'string', required: true },
  },
} as const satisfies ValueSchemaSpec

const elementSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'integer', required: true },
    role: { type: 'string', required: true },
    subrole: { type: 'string' },
    title: { type: 'string' },
    label: { type: 'string' },
    value: { type: 'string' },
    enabled: { type: 'boolean' },
    focused: { type: 'boolean' },
    selected: { type: 'boolean' },
    frame: rectSchema,
    actions: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const satisfies ValueSchemaSpec

const artifactSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    filename: { type: 'string', required: true },
    mimeType: { type: 'string', enum: ['image/png'], required: true },
    kind: { type: 'string', enum: ['image'], required: true },
    description: { type: 'string', required: true },
    sourceTool: { type: 'string', enum: ['computer_observe', 'computer_action'], required: true },
    previewIntent: { type: 'string', enum: ['image'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
  },
} as const satisfies ValueSchemaSpec

const observationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    observationId: { type: 'string', required: true },
    app: { ...appSchema, required: true },
    createdAt: { type: 'string', required: true },
    expiresAt: { type: 'string', required: true },
    frontmost: { type: 'boolean', required: true },
    window: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        frame: { ...rectSchema, required: true },
        id: { type: 'integer' },
      },
    },
    tree: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        mode: { type: 'string', enum: ['full', 'diff'], required: true },
        text: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
      },
    },
    elements: { type: 'array', items: elementSchema, required: true },
    screenshot: artifactSchema,
    permissions: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        accessibility: { type: 'string', enum: ['granted', 'denied', 'not-determined', 'unavailable'], required: true },
        screenRecording: { type: 'string', enum: ['granted', 'denied', 'not-determined', 'unavailable'], required: true },
      },
    },
  },
} as const satisfies ValueSchemaSpec

const actionResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['click', 'set-value', 'type-text', 'press-key', 'scroll', 'drag', 'perform-action', 'wait'], required: true },
    channel: { type: 'string', enum: ['accessibility', 'coordinates', 'keyboard', 'wait'], required: true },
    activation: { type: 'string', enum: ['not-requested', 'already-frontmost', 'activated'], required: true },
    pointerInput: { type: 'boolean', required: true },
    pointerRouting: { type: 'string', enum: ['none', 'target-process'], required: true },
    observation: { ...observationSchema, required: true },
  },
} as const satisfies ValueSchemaSpec

const sensitiveParameters = {
  sensitive: { type: 'boolean', description: 'Set true for an action classified by the Skill as high impact or sensitive.' },
  confirmationToken: { type: 'string', description: 'One-use token from computer_confirm for this exact action.' },
} as const

const keyNames = [
  'a', 's', 'd', 'f', 'h', 'g', 'z', 'x', 'c', 'v', 'b', 'q', 'w', 'e', 'r', 'y', 't',
  '1', '2', '3', '4', '6', '5', '=', '9', '7', '-', '8', '0', ']', 'o', 'u', '[', 'i', 'p',
  'return', 'l', 'j', "'", 'k', ';', '\\', ',', '/', 'n', 'm', '.', 'tab', 'space', 'delete',
  'escape', 'home', 'pageup', 'forwarddelete', 'end', 'pagedown', 'left', 'right', 'down', 'up',
] as const

const confirmationActionSchema = {
  oneOf: [
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'click', required: true },
        observationId: { type: 'string', required: true },
        elementIndex: { type: 'integer' },
        x: { type: 'number' },
        y: { type: 'number' },
        coordinateSpace: { type: 'string', enum: ['window', 'screen'] },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        clickCount: { type: 'integer' },
        allowCoordinateFallback: { type: 'boolean' },
      },
    },
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'set-value', required: true },
        observationId: { type: 'string', required: true },
        elementIndex: { type: 'integer', required: true },
        value: { type: 'string', required: true },
      },
    },
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'type-text', required: true },
        observationId: { type: 'string', required: true },
        text: { type: 'string', required: true },
      },
    },
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'press-key', required: true },
        observationId: { type: 'string', required: true },
        key: { type: 'string', enum: keyNames, required: true },
        modifiers: { type: 'array', items: { type: 'string', enum: ['command', 'control', 'option', 'shift'] } },
      },
    },
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'scroll', required: true },
        observationId: { type: 'string', required: true },
        elementIndex: { type: 'integer' },
        x: { type: 'number' },
        y: { type: 'number' },
        coordinateSpace: { type: 'string', enum: ['window', 'screen'] },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], required: true },
        pages: { type: 'integer' },
      },
    },
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'drag', required: true },
        observationId: { type: 'string', required: true },
        fromX: { type: 'number', required: true },
        fromY: { type: 'number', required: true },
        toX: { type: 'number', required: true },
        toY: { type: 'number', required: true },
        coordinateSpace: { type: 'string', enum: ['window', 'screen'] },
      },
    },
    {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'perform-action', required: true },
        observationId: { type: 'string', required: true },
        elementIndex: { type: 'integer', required: true },
        action: { type: 'string', required: true },
      },
    },
  ],
} as const satisfies ValueSchemaSpec

function actionBase(args: { observationId: string; sensitive?: boolean; confirmationToken?: string }) {
  return {
    observationId: ComputerObservationId(args.observationId),
    ...(args.sensitive === undefined ? {} : { sensitive: args.sensitive }),
    ...(args.confirmationToken === undefined ? {} : { confirmationToken: ComputerConfirmationToken(args.confirmationToken) }),
  }
}

function artifactPresentation(artifact: ComputerArtifact): JsonValue {
  return {
    path: artifact.path,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    kind: artifact.kind,
    description: artifact.description,
    sourceTool: artifact.sourceTool,
    previewIntent: artifact.previewIntent,
    bytes: artifact.bytes,
    width: artifact.width,
    height: artifact.height,
  }
}

function actionOutput() {
  return {
    schema: actionResultSchema,
    render: renderJson,
    presentationMeta: (_args: unknown, value: { observation: { screenshot?: ComputerArtifact } }): JsonValue => value.observation.screenshot === undefined
      ? {}
      : { artifacts: [artifactPresentation(value.observation.screenshot)] },
  }
}

/** Create the focused execution definitions bound to one active Service generation. */
export function createComputerUseTools(service: ComputerUseService): ToolDefinition[] {
  const listApps = defineTool({
    name: 'computer_list_apps',
    description: 'List bounded running user-facing macOS applications. Use this only when the task does not already identify a unique bundle id.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...appSchema.properties,
            frontmost: { type: 'boolean', required: true },
            accessibility: { type: 'string', enum: ['granted', 'denied', 'not-determined', 'unavailable'], required: true },
            screenRecording: { type: 'string', enum: ['granted', 'denied', 'not-determined', 'unavailable'], required: true },
          },
        },
      },
      render: renderJson,
    },
    execute: (_args, exec) => service.listApps(contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'List macOS apps', kind: 'read' }),
  })

  const observe = defineTool({
    name: 'computer_observe',
    description: 'Read a fresh Accessibility observation for one exact running app. Element indexes belong only to the returned observationId. Prefer the tree; request a screenshot for pixel-only facts. When a screenshot needs OCR, visual grounding, or pixel inspection, load the vision-tools Skill and pass the returned Artifact path to its native tools instead of using bash, tesseract, screencapture, or an ad hoc OCR script.',
    parameters: {
      app: { ...appSelectorSchema, required: true },
      screenshot: { type: 'string', enum: ['none', 'optional', 'required'], description: 'Default optional. Required fails when Screen Recording is unavailable.' },
      full: { type: 'boolean', description: 'Return a full tree instead of a diff from the previous observation.' },
    },
    output: {
      schema: observationSchema,
      render: renderJson,
      presentationMeta: (_args, value) => value.screenshot === undefined ? {} : { artifacts: [value.screenshot] },
    },
    execute: async (args, exec) => {
      const observation = await service.observe(args, contextOf(exec))
      deferVisionHandoff(exec, observation.screenshot)
      return observation
    },
    presentCall: () => ({ card: 'generic', title: 'Observe macOS app', kind: 'read' }),
  })

  const click = defineTool({
    name: 'computer_click',
    description: 'Click an element from the exact observation, preferring AXPress without foreground activation, or use a window-relative or screen-global coordinate when host pointer policy allows it. coordinateSpace screen matches Codex-style arbitrary-coordinate clicking: the helper resolves the selected app window under the point and posts target-process input. The successful result reports activation/pointer input and already contains the fresh post-click observation.',
    parameters: {
      observationId: { type: 'string', required: true },
      elementIndex: { type: 'integer' },
      x: { type: 'number' },
      y: { type: 'number' },
      coordinateSpace: { type: 'string', enum: ['window', 'screen'], description: 'Default window interprets x/y inside the observed window frame; screen uses Quartz screen-global coordinates.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clickCount: { type: 'integer' },
      allowCoordinateFallback: { type: 'boolean' },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'click', ...actionBase(args), ...args.elementIndex === undefined ? {} : { elementIndex: args.elementIndex }, ...args.x === undefined ? {} : { x: args.x }, ...args.y === undefined ? {} : { y: args.y }, ...args.coordinateSpace === undefined ? {} : { coordinateSpace: args.coordinateSpace }, ...args.button === undefined ? {} : { button: args.button }, ...args.clickCount === undefined ? {} : { clickCount: args.clickCount }, ...args.allowCoordinateFallback === undefined ? {} : { allowCoordinateFallback: args.allowCoordinateFallback } }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Click macOS app', kind: 'execute' }),
  })

  const setValue = defineTool({
    name: 'computer_set_value',
    description: 'Set one observed editable Accessibility value without using the clipboard. The result omits the supplied value and returns fresh state.',
    parameters: {
      observationId: { type: 'string', required: true },
      elementIndex: { type: 'integer', required: true },
      value: { type: 'string', required: true },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'set-value', ...actionBase(args), elementIndex: args.elementIndex, value: args.value }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Set app value', kind: 'execute' }),
  })

  const typeText = defineTool({
    name: 'computer_type_text',
    description: 'Type Unicode into the currently focused control without reading or replacing the clipboard. Focus a control using fresh state first; keyboard fallback may require host-authorized foreground activation. The result does not echo the supplied text.',
    parameters: {
      observationId: { type: 'string', required: true },
      text: { type: 'string', required: true },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'type-text', ...actionBase(args), text: args.text }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Type in macOS app', kind: 'execute' }),
  })

  const pressKey = defineTool({
    name: 'computer_press_key',
    description: 'Press one validated key or chord by routing it to the selected app process. The default host policy preserves the current foreground app; use documented key names and read the returned fresh observation.',
    parameters: {
      observationId: { type: 'string', required: true },
      key: { type: 'string', enum: keyNames, required: true },
      modifiers: { type: 'array', items: { type: 'string', enum: ['command', 'control', 'option', 'shift'] } },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'press-key', ...actionBase(args), key: args.key, ...args.modifiers === undefined ? {} : { modifiers: args.modifiers } }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Press app key', kind: 'execute' }),
  })

  const scroll = defineTool({
    name: 'computer_scroll',
    description: 'Scroll by routing a wheel event only to the selected app process at an observed element or window-relative/screen-global coordinate. The system cursor is not moved.',
    parameters: {
      observationId: { type: 'string', required: true },
      elementIndex: { type: 'integer' },
      x: { type: 'number' },
      y: { type: 'number' },
      coordinateSpace: { type: 'string', enum: ['window', 'screen'], description: 'Default window interprets x/y inside the observed window frame; screen uses Quartz screen-global coordinates.' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], required: true },
      pages: { type: 'integer' },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'scroll', ...actionBase(args), direction: args.direction, ...args.elementIndex === undefined ? {} : { elementIndex: args.elementIndex }, ...args.x === undefined ? {} : { x: args.x }, ...args.y === undefined ? {} : { y: args.y }, ...args.coordinateSpace === undefined ? {} : { coordinateSpace: args.coordinateSpace }, ...args.pages === undefined ? {} : { pages: args.pages } }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Scroll macOS app', kind: 'execute' }),
  })

  const drag = defineTool({
    name: 'computer_drag',
    description: 'Drag by routing mouse events only to the selected app process between two points in the observed-window or screen-global coordinate space. The system cursor is not moved.',
    parameters: {
      observationId: { type: 'string', required: true },
      fromX: { type: 'number', required: true },
      fromY: { type: 'number', required: true },
      toX: { type: 'number', required: true },
      toY: { type: 'number', required: true },
      coordinateSpace: { type: 'string', enum: ['window', 'screen'], description: 'Default window interprets the points inside the observed window frame; screen uses Quartz screen-global coordinates.' },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'drag', ...actionBase(args), fromX: args.fromX, fromY: args.fromY, toX: args.toX, toY: args.toY, ...args.coordinateSpace === undefined ? {} : { coordinateSpace: args.coordinateSpace } }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Drag in macOS app', kind: 'execute' }),
  })

  const perform = defineTool({
    name: 'computer_perform_action',
    description: 'Perform one exact Accessibility action advertised by an element in the referenced observation.',
    parameters: {
      observationId: { type: 'string', required: true },
      elementIndex: { type: 'integer', required: true },
      action: { type: 'string', required: true },
      ...sensitiveParameters,
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'perform-action', ...actionBase(args), elementIndex: args.elementIndex, action: args.action }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Perform app action', kind: 'execute' }),
  })

  const wait = defineTool({
    name: 'computer_wait',
    description: 'Wait for one bounded Accessibility condition and return fresh state without mutating the app.',
    parameters: {
      observationId: { type: 'string', required: true },
      condition: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          text: { type: 'string' },
          elementRole: { type: 'string' },
          elementTitle: { type: 'string' },
        },
      },
      timeoutMs: { type: 'integer' },
    },
    output: actionOutput(),
    execute: (args, exec) => service.act({ kind: 'wait', observationId: ComputerObservationId(args.observationId), condition: args.condition, ...args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs } }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Wait for app state', kind: 'read' }),
  })

  const confirm = defineTool({
    name: 'computer_confirm',
    description: 'Request just-in-time approval for one exact sensitive action. Call immediately before the action, then repeat the same action with sensitive=true and the returned token.',
    parameters: {
      action: { ...confirmationActionSchema, required: true },
      reason: { type: 'string', required: true },
      target: { type: 'string', required: true },
      dataSummary: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          token: { type: 'string', required: true },
          observationId: { type: 'string', required: true },
          app: { ...appSchema, required: true },
          expiresAt: { type: 'string', required: true },
        },
      },
      render: renderJson,
    },
    execute: (args, exec) => service.confirm({
      action: { ...args.action, observationId: ComputerObservationId(args.action.observationId), sensitive: true } as ComputerActionRequest,
      reason: args.reason,
      target: args.target,
      ...(args.dataSummary === undefined ? {} : { dataSummary: args.dataSummary }),
    }, contextOf(exec)),
    presentCall: () => ({ card: 'generic', title: 'Confirm sensitive app action', kind: 'execute' }),
  })

  return [listApps, observe, click, setValue, typeText, pressKey, scroll, drag, perform, wait, confirm]
}
