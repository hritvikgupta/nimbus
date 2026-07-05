/**
 * LLM provider factory — the single place Nimbus agents get their model.
 *
 * Toggle between providers with LLM_PROVIDER ("databricks" | "openrouter"):
 *  · databricks → Databricks Model Serving (OpenAI-compatible) e.g. databricks-claude-sonnet-4-6
 *  · openrouter → OpenRouter (e.g. deepseek/deepseek-v4-flash)
 *
 * Config is read from the process env, then this project's .env, then ~/company-brain/.env.
 * Exports stay `chatModel` / `MODEL` so callers don't change.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const ENV_FILES = [path.join(process.cwd(), '.env'), path.join(os.homedir(), 'company-brain', '.env')]

/** Read a config value from env → project .env → company-brain .env. */
function cfg(key) {
  if (process.env[key]) return process.env[key]
  for (const file of ENV_FILES) {
    try {
      const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.trim().startsWith(key + '='))
      if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
    } catch { /* next */ }
  }
  return undefined
}

const PROVIDER = (cfg('LLM_PROVIDER') || 'openrouter').toLowerCase()

// Per provider so an LLM_MODEL meant for OpenRouter never leaks into the Databricks endpoint name.
export const MODEL = PROVIDER === 'databricks'
  ? (cfg('DATABRICKS_MODEL') || 'databricks-claude-sonnet-4-6')
  : (cfg('LLM_MODEL') || 'deepseek/deepseek-v4-flash')

let _databricks = null
function databricks() {
  if (!_databricks) {
    const host = cfg('DATABRICKS_HOST')
    const token = cfg('DATABRICKS_TOKEN')
    if (!host || !token) throw new Error('DATABRICKS_HOST / DATABRICKS_TOKEN are not set (env or .env).')
    // Databricks serving endpoints are OpenAI-compatible under <host>/serving-endpoints.
    _databricks = createOpenAICompatible({
      name: 'databricks',
      baseURL: host.replace(/\/+$/, '') + '/serving-endpoints',
      apiKey: token,
    })
  }
  return _databricks
}

let _openrouter = null
function openrouter() {
  if (!_openrouter) {
    const key = cfg('OPENROUTER_API_KEY')
    if (!key) throw new Error('OPENROUTER_API_KEY is not set (env or ~/company-brain/.env).')
    _openrouter = createOpenRouter({ apiKey: key })
  }
  return _openrouter
}

/** The chat model handle agents pass to streamText/generateText. */
export const chatModel = (model = MODEL) =>
  PROVIDER === 'databricks' ? databricks()(model) : openrouter().chat(model)

export const LLM_PROVIDER = PROVIDER
