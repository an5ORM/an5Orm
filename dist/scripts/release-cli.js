#!/usr/bin/env tsx
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function run(cmd, allowFail = false) {
    try {
        return (0, child_process_1.execSync)(cmd, { encoding: 'utf8' }).trim();
    }
    catch (error) {
        if (allowFail)
            return error.stdout?.toString()?.trim() || '';
        throw error;
    }
}
function inferComponent(file) {
    const normalized = file.replace('\\', '/').toLowerCase();
    if (normalized.includes('/generator/'))
        return 'generator';
    if (normalized.includes('/an5client/'))
        return 'client';
    if (normalized.includes('/an5schema/'))
        return 'schema';
    if (normalized.includes('/.github/'))
        return 'ci';
    if (normalized.includes('package.json') || normalized.includes('tsconfig'))
        return 'build';
    if (normalized.includes('.md'))
        return 'docs';
    return 'misc';
}
function collectChanges() {
    const status = run('git status --porcelain');
    const files = status
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.slice(3).trim())
        .filter(Boolean);
    const groups = new Map();
    for (const file of files) {
        const component = inferComponent(file);
        if (!groups.has(component)) {
            groups.set(component, { component, files: [], summary: '' });
        }
        groups.get(component).files.push(file);
    }
    return Array.from(groups.values()).map(group => ({
        ...group,
        summary: `${group.component} updates`
    }));
}
function generateChangelog(groups) {
    const lines = ['# Changelog', ''];
    for (const group of groups) {
        lines.push(`## ${group.component}`);
        lines.push(`- ${group.summary}`);
        for (const file of group.files) {
            lines.push(`  - ${file}`);
        }
        lines.push('');
    }
    return lines.join('\n').trim();
}
async function maybeUseLLM(summary) {
    let apiKey = '';
    try {
        const configPath = require('path').join(__dirname, '..', '..', 'an5Adapters', 'typescript', 'config');
        const mod = require(configPath);
        if (mod?.getLlmConfig) {
            const db = await mod.getLlmConfig();
            if (db)
                apiKey = db.apiKey;
        }
    }
    catch { }
    if (!apiKey)
        return summary;
    try {
        const prompt = `Summarize these changes into one concise release note in English:\n${summary}`;
        const payload = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'You are a helpful release note writer.' }, { role: 'user', content: prompt }] });
        const response = run(`curl -s https://api.openai.com/v1/chat/completions -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '${payload}'`, true);
        const parsed = JSON.parse(response);
        return parsed.choices?.[0]?.message?.content?.trim() || summary;
    }
    catch {
        return summary;
    }
}
async function main() {
    const groups = collectChanges();
    if (groups.length === 0) {
        console.log('No modified files detected.');
        process.exit(0);
    }
    const changelog = generateChangelog(groups);
    const outputPath = path_1.default.resolve(process.cwd(), 'CHANGELOG.md');
    fs_1.default.writeFileSync(outputPath, changelog + '\n');
    const summary = groups.map(g => `${g.component}: ${g.files.join(', ')}`).join('\n');
    const llmSummary = await maybeUseLLM(summary);
    console.log('\nGenerated changelog:\n');
    console.log(changelog);
    console.log('\nLLM summary:\n');
    console.log(llmSummary);
    const message = groups.map(g => g.component).join(', ');
    const commitMessage = `chore: update ${message}`;
    run(`git add -A`);
    run(`git commit -m "${commitMessage}"`, true);
    console.log(`\nCommitted with: ${commitMessage}`);
}
main().catch(console.error);
//# sourceMappingURL=release-cli.js.map