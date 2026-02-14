import { GoogleGenerativeAI, Tool } from '@google/generative-ai';
import { callMcpTool, getGeminiTools } from './mcp.js';
import { getSkillContext } from './skill.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

let genAI: GoogleGenerativeAI | null = null;

function buildSystemPrompt(skillMd: string): string {
  const skillSection = skillMd
    ? `\n## ドキュメントの能力と範囲

以下は、このドキュメントがカバーする規格・能力の概要です。質問に回答する際、この情報を参考に適切なドキュメントを検索してください。

${skillMd}
`
    : '';

  return `あなたは IAB Tech Lab ドキュメントの質問に答えるアシスタントです。
${skillSection}
## ルール
1. 利用可能なツール検索ツールを使用して、ドキュメントを検索し、質問に答えてください。
2. ユーザーの質問に対して、${skillMd ? '上記の能力と範囲を参考に、' : ''}適切なキーワードで検索を行ってください。
3. ツールから得られた情報のみを根拠に回答してください。情報がない場合は正直にそう伝えてください。
4. 回答は日本語で、簡潔に行ってください。
5. 回答の末尾に、参照したドキュメントのURLを必ずリストアップしてください。
6. 複数の規格にまたがる質問の場合、関連する全ての規格から情報を収集してから回答してください。
`;
}

interface GenerateAnswerResult {
  answer: string;
  success: boolean;
}

function getModel(tools: Tool[], systemInstruction: string) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }

  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction,
    tools: tools
  });
}

/**
 * Gemini Agent Loop to process question with tools
 */
export async function generateAnswer(question: string): Promise<GenerateAnswerResult> {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set');
    return { answer: '設定エラー: GEMINI_API_KEYが設定されていません', success: false };
  }

  try {
    // Get tools from MCP
    const toolDeclarations = await getGeminiTools();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];

    // Build dynamic system prompt with skill.md
    const skillMd = await getSkillContext();
    const systemPrompt = buildSystemPrompt(skillMd);

    // Initialize model with tools
    const model = getModel(tools, systemPrompt);

    const chat = model.startChat({
      history: [],
    });

    console.log(`Agent processing question: "${question}" with model ${MODEL_NAME}`);
    let result = await chat.sendMessage(question);

    const MAX_ITERATIONS = 10;
    let iteration = 0;

    // Tool execution loop
    while (iteration < MAX_ITERATIONS) {
      const response = result.response;

      // Check for function calls
      // In newer SDKs, use functionCalls() helper
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        console.log(`Tool usage detected: ${functionCalls.length} calls`);
        const parts: any[] = [];

        // Execute all requested tools
        for (const call of functionCalls) {
          try {
            const toolResult = await callMcpTool(call.name, call.args);
            parts.push({
              functionResponse: {
                name: call.name,
                response: { content: toolResult.content }
              }
            });
          } catch (err: any) {
            console.error(`Tool execution error for ${call.name}:`, err);
            parts.push({
              functionResponse: {
                name: call.name,
                response: { error: err.message }
              }
            });
          }
        }

        // Send tool outputs back to Gemini to continue generation
        result = await chat.sendMessage(parts);
      } else {
        // No more tool calls, we have the final text response
        break;
      }
      iteration++;
    }

    const answer = result.response.text();
    return { answer, success: true };

  } catch (err: any) {
    console.error('Gemini Agent error:', err);
    return { answer: '回答の生成中にエラーが発生しました。', success: false };
  }
}
