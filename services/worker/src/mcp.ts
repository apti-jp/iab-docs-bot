import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.MCP_URL || 'https://iab-docs.apti.jp/mcp';

let client: Client | null = null;

interface SearchResult {
  content: string;
  sources: string[];
}

/**
 * MCPクライアントを初期化して接続
 */
async function getClient(): Promise<Client> {
  if (client) {
    return client;
  }

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  client = new Client({ name: 'iab-docs-bot', version: '1.0.0' });

  await client.connect(transport);
  console.log(`Connected to MCP server: ${MCP_URL}`);

  // 利用可能なツールを確認
  const { tools } = await client.listTools();
  console.log(
    'Available tools:',
    tools.map((t) => t.name),
  );

  return client;
}

/**
 * MCPサーバーでドキュメントを検索
 */
export async function searchDocuments(query: string): Promise<SearchResult> {
  const mcpClient = await getClient();

  // 利用可能なツールを再確認
  const { tools } = await mcpClient.listTools();
  console.log(
    `Available MCP tools: ${JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description })))}`,
  );

  // searchツールを探す（大文字小文字を区別しない）
  const searchTool = tools.find(
    (t) => t.name.toLowerCase().includes('search') || t.name.toLowerCase().includes('query'),
  );

  if (!searchTool) {
    console.error(`No search tool found. Available tools: ${tools.map((t) => t.name).join(', ')}`);
    return { content: '', sources: [] };
  }

  console.log(`Using tool: ${searchTool.name} for query: "${query}"`);

  const result = await mcpClient.callTool({
    name: searchTool.name,
    arguments: {
      query,
    },
  });

  // レスポンスからテキストを抽出
  let content = '';
  const sources: string[] = [];

  if (result.content && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        content += item.text + '\n\n';

        // URLを抽出（マークダウンリンク形式）
        const urlMatches = item.text.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g);
        if (urlMatches) {
          sources.push(...urlMatches);
        }
      }
    }
  }

  console.log(`MCP search complete. Content length: ${content.length}, Sources: ${sources.length}`);

  return {
    content: content.trim(),
    sources: [...new Set(sources)], // 重複除去
  };
}

/**
 * MCPクライアントを閉じる
 */
export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
