/**
 * Live resource config — for a DEPLOYED resource, fetch its ACTUAL current state straight from
 * the cloud via the MCP (describe-* / gcloud describe), so the resource panel shows what's really
 * running. Generic across services (the model drives the right describe command). No Terraform.
 */
import { generateText, stepCountIs } from 'ai'
import { chatModel } from '../libs/openrouter.mjs'
import { allMcpToolsFor } from '../libs/mcp.mjs'
import { getConnections } from '../repositories/connections.mjs'

function parseJson(text) {
  if (!text) return null
  let t = String(text).trim().replace(/```(?:json)?/gi, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a === -1 || b === -1) return null
  t = t.slice(a, b + 1)
  for (const c of [t, t.replace(/,\s*([}\]])/g, '$1')]) { try { return JSON.parse(c) } catch { /* next */ } }
  return null
}

const SYS = `You inspect ONE specific, already-deployed cloud resource and return its CURRENT
editable configuration, read straight from the cloud with your tools — never from memory.
 AWS (call_aws): describe the resource, e.g. aws ec2 describe-instances --instance-ids <id>,
   aws rds describe-db-instances --db-instance-identifier <id>, aws s3api get-bucket-* , etc.
 GCP (run_gcloud_command): gcloud compute instances describe <name> --zone=…, etc.
Then output STRICT JSON ONLY (no prose/fences):
{ "found": true|false,
  "fields": [ { "key":"instance_type","label":"Instance type","type":"text|number|bool|select",
     "value": <current live value>, "options":[...]?, "editable": true|false } ] }
- Include the 5-9 fields that matter (size/type/storage/version/capacity…), each with its REAL
  current value. Mark "editable": false for fields the cloud can't change in place (e.g. AMI, AZ).
- If the resource can't be found, return { "found": false, "fields": [] }. NEVER invent values.`

/** Fetch the live config of a deployed resource via the MCP. */
export async function liveConfig(userId, cloud, type, name, region) {
  if (!cloud || !Object.keys(getConnections(userId)).includes(cloud)) return { found: false, fields: [] }
  const tools = await allMcpToolsFor(userId, [cloud])
  for (let i = 0; i < 2; i++) {
    const { text } = await generateText({
      model: chatModel(),
      system: SYS + (i ? '\n\nReturn the JSON object ONLY.' : ''),
      prompt: `Cloud: ${cloud}\nService type: ${type}\nResource name/identifier: ${name}\nRegion: ${region || 'us-east-1'}\nReturn the live config JSON now.`,
      tools, stopWhen: stepCountIs(8), temperature: 0, maxOutputTokens: 1000, maxRetries: 1,
    }).catch(() => ({ text: '' }))
    const j = parseJson(text)
    if (j && Array.isArray(j.fields)) return { found: j.found !== false, fields: j.fields }
  }
  return { found: false, fields: [] }
}
