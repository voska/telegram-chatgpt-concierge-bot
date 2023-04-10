import { AgentExecutor, Tool, initializeAgentExecutor } from "langchain/agents";
import { ChatOpenAI } from "langchain/chat_models";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import { Configuration } from "openai";
import { OpenAIApi } from "openai";
import { googleTool } from "./tools/google";

const openAIApiKey = process.env.OPENAI_API_KEY!;
const botName = process.env.BOT_NAME || 'AI';

const params = {
  verbose: true,
  temperature: 1,
  openAIApiKey,
  modelName: "gpt-3.5-turbo",
  maxConcurrency: 1,
  maxTokens: 1000,
  maxRetries: 5,
};

export class Model {
  public tools: Tool[];
  public executor?: AgentExecutor;
  public openai: OpenAIApi;
  public model: ChatOpenAI;

  constructor() {
    const configuration = new Configuration({
      apiKey: openAIApiKey,
    });

    this.tools = [googleTool];
    this.openai = new OpenAIApi(configuration);
    this.model = new ChatOpenAI(params, configuration);
  }

  public async call(input: string) {
    if (!this.executor) {
      
        const prompt = ZeroShotAgent.createPrompt(tools, {
          prefix: `Answer the following questions as best you can. The user may address you as ROBORTA, and if prompted, you will address yourself as ROBORTA, a female voiced conversational AI:`,
          suffix: `Begin!`,
        });

        const chatPrompt = ChatPromptTemplate.fromPromptMessages([
          new SystemMessagePromptTemplate(prompt),
          HumanMessagePromptTemplate.fromTemplate(`{input}

      This was your previous work (but I haven't seen any of it! I only see what you return as final answer):
      {agent_scratchpad}`),
        ]);

   
      const llmChain = new LLMChain({
        prompt: chatPrompt,
        llm: this.model,
      });

      const agent = new ZeroShotAgent({
        llmChain,
        allowedTools: tools.map((tool) => tool.name),
      });

      this.executor = AgentExecutor.fromAgentAndTools({ agent, tools });

   }

    const response = await this.executor!.call({ input });

    console.log(response);

    return response.output;
  }
}
