/** The retained upstream source adapters declare their optional host service here;
 * Spirit itself does not load the GitHub/Feishu adapters. */
import type { SourceHost } from '../upstream/src/sources/host.ts'
import type {} from '@deepseek-ai/dsh-skill'
declare module '@deepseek-ai/cordis' {
  interface Context { orchestrator: SourceHost }
}
