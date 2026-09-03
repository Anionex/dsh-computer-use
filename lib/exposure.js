/** Agent-scoped progressive exposure for Computer Use execution Tools. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { COMPUTER_USE_SKILL_CONTENT, COMPUTER_USE_SKILL_NAME } from "./skill.js";
/** One global bootstrap retained until the current Agent loads the Skill. */
export const COMPUTER_USE_ACTIVATE = 'computer_use_activate';
const VISION_TOOL_NAMES = [
    'vision_glance',
    'vision_ground',
    'vision_detect',
    'vision_crop',
    'vision_long_screenshot_ocr',
    'vision_toolkit_activate',
];
const COMMAND_PREFIX = /^(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+)\s+)*(?:(?:\S*\/)?(?:sudo|env|nohup|time|command|exec)\s+(?:(?:-\S+|[A-Za-z_][A-Za-z0-9_]*=\S+)\s+)*)?/iu;
const OCR_COMMAND_PROBE = /^(?:which|type|command\s+-v)\b[^\n;&|]*\b(?:tesseract|screencapture)\b/iu;
const OCR_EXECUTABLE = /^(?:\S*\/)?(?:tesseract|screencapture)(?:\s|$)/iu;
const OCR_STACK_SETUP = /^(?:(?:\S*\/)?(?:brew|port|apt(?:-get)?|dnf|yum|pacman)\b[^\n]*(?:install|add)\b[^\n]*\btesseract(?:-ocr)?\b|(?:\S*\/)?(?:pip(?:3(?:\.\d+)*)?|uv\s+pip|poetry\s+add|pdm\s+add)\b[^\n]*(?:install|add)?[^\n]*\b(?:pytesseract|easyocr|ocrmypdf)\b)/iu;
const SCRIPTED_OCR_EXECUTABLE = /^(?:\S*\/)?(?:python(?:3(?:\.\d+)*)?|swift)(?:\s|$)/iu;
const SCRIPTED_OCR_MARKER = /(?:\bpytesseract\b|\beasyocr\b|\bocrmypdf\b|VNRecognizeTextRequest|\bimport\s+Vision\b)/iu;
const SHELL_META = /(?:&&|\|\||[;|\n])/u;
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function adHocOcrCommand(value) {
    if (!isRecord(value) || typeof value.command !== 'string')
        return false;
    const commands = value.command.split(SHELL_META)
        .map(command => command.trimStart().replace(COMMAND_PREFIX, ''));
    if (commands.some(command => OCR_COMMAND_PROBE.test(command)
        || OCR_EXECUTABLE.test(command)
        || OCR_STACK_SETUP.test(command)))
        return true;
    return SCRIPTED_OCR_MARKER.test(value.command)
        && commands.some(command => SCRIPTED_OCR_EXECUTABLE.test(command));
}
function isSkillArguments(value) {
    return isRecord(value) && value.name === COMPUTER_USE_SKILL_NAME;
}
function nativeSkillCall(raw) {
    try {
        return isSkillArguments(JSON.parse(raw));
    }
    catch {
        return false;
    }
}
function containsSkillContent(blocks) {
    return blocks.some(block => isRecord(block)
        && block.type === 'text'
        && typeof block.text === 'string'
        && block.text.includes(COMPUTER_USE_SKILL_CONTENT));
}
function isSkillResult(value) {
    return isRecord(value)
        && value.name === COMPUTER_USE_SKILL_NAME
        && value.content === COMPUTER_USE_SKILL_CONTENT;
}
/** Whether durable Session history proves that the bundled Skill was loaded. */
export function hasLoadedComputerUseSkill(session) {
    const nativeCalls = new Set();
    const events = typeof session.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : session.events ?? [];
    for (const event of events) {
        if (event.type === 'user/message') {
            const source = event.data.source;
            if (source.kind === 'skill-invocation'
                && source.name === COMPUTER_USE_SKILL_NAME
                && containsSkillContent(event.data.content))
                return true;
            continue;
        }
        if (event.type === 'tool/call') {
            if (event.data.name === 'skill' && nativeSkillCall(event.data.arguments))
                nativeCalls.add(String(event.data.callId));
            continue;
        }
        if (event.type === 'tool/result') {
            const [block] = event.data.message.content;
            if (block?.type === 'tool-result'
                && block.isError !== true
                && nativeCalls.has(String(block.toolCallId))
                && containsSkillContent(block.content))
                return true;
            continue;
        }
        if (event.type === 'tool/code-dispatch'
            && event.data.name === 'skill'
            && event.data.isError === false
            && isSkillArguments(event.data.arguments)
            && containsSkillContent(event.data.content))
            return true;
    }
    return false;
}
/** Owns one progressive Tool-exposure generation. */
export class ComputerUseExposure {
    ctx;
    createTools;
    activationTool;
    states = new Map();
    installed = false;
    constructor(ctx, createTools) {
        this.ctx = ctx;
        this.createTools = createTools;
        this.activationTool = defineTool({
            name: COMPUTER_USE_ACTIVATE,
            description: `Activate the macOS Computer Use execution tools for this Agent after loading the ${COMPUTER_USE_SKILL_NAME} Skill. The Skill tool normally activates them automatically; call this only after a direct Skill invocation when the tools are still absent. This bootstrap disappears after success.`,
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        activated: { type: 'boolean', required: true },
                        tools: { type: 'array', items: { type: 'string' }, required: true },
                    },
                },
                render: renderJson,
            },
            execute: (_args, exec) => {
                if (exec.agent === undefined)
                    throw new Error(`${COMPUTER_USE_ACTIVATE}: an Agent Session is required`);
                if (!hasLoadedComputerUseSkill(exec.agent.session)) {
                    throw new Error(`${COMPUTER_USE_ACTIVATE}: load the ${COMPUTER_USE_SKILL_NAME} Skill first`);
                }
                return Promise.resolve(this.activate(exec.agent));
            },
            presentCall: () => ({ card: 'generic', title: 'Activate Computer Use', kind: 'execute' }),
        });
    }
    /** Install lifecycle listeners and adopt existing Agents. */
    install() {
        if (this.installed)
            throw new Error('dsh-computer-use: progressive exposure is already installed');
        this.installed = true;
        const effects = [
            this.ctx.on('agent/created', ({ agent }) => { this.attach(agent); }),
            this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent); }),
            this.ctx.tools.guard((exec) => {
                if (exec.name !== 'bash'
                    || exec.agent === undefined
                    || !hasLoadedComputerUseSkill(exec.agent.session)
                    || !adHocOcrCommand(exec.arguments)
                    || !VISION_TOOL_NAMES.some(name => this.ctx.tools.get(name, exec.agent) !== undefined))
                    return undefined;
                return 'Computer Use screenshot analysis must use the installed Vision Toolkit instead of a shell-built OCR stack. If vision_glance is absent, call the skill tool with {"name":"vision-tools"}; then pass the existing screenshot Artifact path to vision_glance, vision_ground, vision_detect, vision_crop, or vision_long_screenshot_ocr.';
            }),
            this.ctx.on('tools/result', (exec, result) => {
                if (result.isError === false
                    && exec.name === 'skill'
                    && exec.agent !== undefined
                    && isSkillArguments(exec.arguments)
                    && isSkillResult(result.value))
                    this.activate(exec.agent);
                return undefined;
            }),
        ];
        try {
            for (const agent of this.ctx.agents.list())
                this.attach(agent);
        }
        catch (error) {
            for (const dispose of effects.reverse())
                dispose();
            this.disposeStates();
            this.installed = false;
            throw error;
        }
        return () => {
            if (!this.installed)
                return;
            this.installed = false;
            for (const dispose of effects.reverse())
                dispose();
            this.disposeStates();
        };
    }
    attach(agent) {
        if (this.states.has(agent))
            return;
        this.states.set(agent, { active: false, toolDisposers: [], toolNames: [] });
        if (hasLoadedComputerUseSkill(agent.session))
            this.activate(agent);
    }
    activate(agent) {
        this.attach(agent);
        const state = this.states.get(agent);
        if (state === undefined)
            throw new Error(`dsh-computer-use: Agent ${String(agent.id)} has no exposure state`);
        if (state.active)
            return { activated: false, tools: [...state.toolNames] };
        const definitions = this.createTools();
        const toolDisposers = [];
        let hideActivation;
        try {
            for (const definition of definitions)
                toolDisposers.push(agent.ctx.tools.register(definition));
            hideActivation = agent.ctx.tools.restrict({ deny: [COMPUTER_USE_ACTIVATE] });
        }
        catch (error) {
            hideActivation?.();
            for (const dispose of toolDisposers.reverse())
                dispose();
            throw error;
        }
        state.active = true;
        state.hideActivation = hideActivation;
        state.toolDisposers = toolDisposers;
        state.toolNames = definitions.map(definition => definition.name);
        return { activated: true, tools: [...state.toolNames] };
    }
    detach(agent) {
        const state = this.states.get(agent);
        if (state === undefined)
            return;
        this.states.delete(agent);
        this.disposeState(state);
    }
    disposeStates() {
        for (const state of this.states.values())
            this.disposeState(state);
        this.states.clear();
    }
    disposeState(state) {
        state.hideActivation?.();
        for (const dispose of state.toolDisposers.reverse())
            dispose();
    }
}
//# sourceMappingURL=exposure.js.map