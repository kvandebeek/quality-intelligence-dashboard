import { Client } from '@elastic/elasticsearch';
import type { ElasticConfig, RunSummary, TargetRunArtifacts } from '../models/types.js';

export async function publishToElasticsearch(config: ElasticConfig, summary: RunSummary, artifacts: TargetRunArtifacts[]): Promise<void> {
  if (!config.enabled || !config.node) {
    return;
  }

  const client = new Client({
    node: config.node,
    auth: config.apiKey
      ? { apiKey: config.apiKey }
      : config.username && config.password
        ? { username: config.username, password: config.password }
        : undefined
  });

  const index = `${config.indexPrefix ?? 'quality-signal'}-runs`;

  await client.indices.putTemplate({
    name: `${index}-template`,
    index_patterns: [`${config.indexPrefix ?? 'quality-signal'}-*`],
    template: {
      mappings: {
        properties: {
          metadata: { type: 'object', enabled: true },
          artifacts: { type: 'object', enabled: true }
        }
      }
    }
  });

  await client.index({
    index,
    document: {
      metadata: summary.metadata,
      artifacts
    }
  });
}
