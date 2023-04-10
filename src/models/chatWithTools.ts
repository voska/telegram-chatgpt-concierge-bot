import { AgentExecutor, Tool, initializeAgentExecutor } from "langchain/agents";
import { ChatOpenAI } from "langchain/chat_models";
import { LLMChain } from "langchain";
import { ZeroShotAgent } from "langchain/agents";
import { SerpAPI, Calculator} from "langchain/tools";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import {
  LLMSingleActionAgent,
  AgentActionOutputParser
} from "langchain/agents";
import {
  BasePromptTemplate,
  SerializedBasePromptTemplate,
  renderTemplate,
  BaseChatPromptTemplate,
} from "langchain/prompts";
import {
  InputValues,
  PartialValues,
  AgentStep,
  AgentAction,
  AgentFinish,
  BaseChatMessage,
  HumanChatMessage,
} from "langchain/schema";
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import { Configuration } from "openai";
import { OpenAIApi } from "openai";
import { googleTool } from "./tools/google";

const openAIApiKey = process.env.OPENAI_API_KEY!;

const params = {
  verbose: true,
  temperature: 0,
  openAIApiKey,
  modelName: "gpt-3.5-turbo",
  maxConcurrency: 1,
  maxTokens: 1000,
  maxRetries: 5,
};




const PREFIX = `You are ROBORTA, a helpful assistant, address yourself as female if prompted. Answer the following questions as best you can. 
You have access to the following tools:`;
const formatInstructions = (toolNames: string) => `Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${toolNames}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question`;
const SUFFIX = `Begin!

Question: {input}
Thought:{agent_scratchpad}`;

class CustomPromptTemplate extends BaseChatPromptTemplate {
  tools: Tool[];

  constructor(args: { tools: Tool[]; inputVariables: string[] }) {
    super({ inputVariables: args.inputVariables });
    this.tools = args.tools;
  }

  _getPromptType(): string {
    throw new Error("Not implemented");
  }

  async formatMessages(values: InputValues): Promise<BaseChatMessage[]> {
    /** Construct the final template */
    const toolStrings = this.tools
      .map((tool) => `${tool.name}: ${tool.description}`)
      .join("\n");
    const toolNames = this.tools.map((tool) => tool.name).join("\n");
    const instructions = formatInstructions(toolNames);
    const template = [PREFIX, toolStrings, instructions, SUFFIX].join("\n\n");
    /** Construct the agent_scratchpad */
    const intermediateSteps = values.intermediate_steps as AgentStep[];
    const agentScratchpad = intermediateSteps.reduce(
      (thoughts, { action, observation }) =>
        thoughts +
        [action.log, `\nObservation: ${observation}`, "Thought:"].join("\n"),
      ""
    );
    const newInput = { agent_scratchpad: agentScratchpad, ...values };
    /** Format the template. */
    const formatted = renderTemplate(template, "f-string", newInput);
    return [new HumanChatMessage(formatted)];
  }

  partial(_values: PartialValues): Promise<BasePromptTemplate> {
    throw new Error("Not implemented");
  }

  serialize(): SerializedBasePromptTemplate {
    throw new Error("Not implemented");
  }
}

class CustomOutputParser extends AgentActionOutputParser {
  async parse(text: string): Promise<AgentAction | AgentFinish> {
    if (text.includes("Final Answer:")) {
      const parts = text.split("Final Answer:");
      const input = parts[parts.length - 1].trim();
      const finalAnswers = { output: input };
      return { log: text, returnValues: finalAnswers };
    }

    const match = /Action: (.*)\nAction Input: (.*)/s.exec(text);
    if (!match) {
      return {
        tool: 'None',
        toolInput: 'None',
        log: text + " Final Answer:",
      };
    }

    return {
      tool: match[1].trim(),
      toolInput: match[2].trim().replace(/^"+|"+$/g, ""),
      log: text,
    };
  }

  getFormatInstructions(): string {
    throw new Error("Not implemented");
  }
}






export class Model {

  public executor?: AgentExecutor;

  constructor() {
   


  }

  public async call(input: string) {
    await this._init()

    
    console.log(input);
    const response = await this.executor!.call({ input });

    console.log(response);

    return response.output;
  }

  async  _init() {

    let tools = [googleTool,  new Calculator()];
    const configuration = new Configuration({
      apiKey: openAIApiKey,
    });
    let model = new ChatOpenAI(params, configuration);


    const llmChain = new LLMChain({
      prompt: new CustomPromptTemplate({
        tools,
        inputVariables: ["input", "agent_scratchpad"],
      }),
      llm: model,
    });
  
    const agent = new LLMSingleActionAgent({
      llmChain,
      outputParser: new CustomOutputParser(),
      stop: ["\nObservation"],
    });

    this.executor = new AgentExecutor({
      agent,
      tools,
      verbose: true
    });

    
  }
}
