import { AgentExecutor, Tool, initializeAgentExecutor } from "langchain/agents";
import { ChatOpenAI } from "langchain/chat_models";
import { LLMChain } from "langchain";
import { ZeroShotAgent } from "langchain/agents";
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
  ChatMessage,
  SystemChatMessage,
} from "langchain/schema";
import { BufferMemory  } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import { Configuration } from "openai";
import { OpenAIApi } from "openai";
import { GoogleTool } from "./tools/google";
import { Message } from "telegraf/typings/core/types/typegram";
import { MemoryVariables, OutputValues } from "langchain/dist/memory/base";
import { DynamicTool } from "langchain/tools";
import { CalculatorTool } from "./tools/calculator";

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



const PREFIX = `You have access to the following tools:`;
const formatInstructions = (toolNames: string) => `
answer in this format:

list all entities and relationship ordered 

then

Observe: list all the entities that need to be researched to understand the scenario
Orient: pick the first from the list
Action: write on a single line one of [${toolNames}] followed by : and the input for the tool in quotes
...(loop n times until the list of entities that need to be researched is empty)
Final Answer: the question
`;
const SUFFIX = `Scenario:

{chat_history}

{input}

{agent_scratchpad}`;

class CustomMemory extends BufferMemory {
  constructor() {
    super({ memoryKey: "chat_history" });
  }

  getBufferString = function(
    messages: BaseChatMessage[],
    human_prefix = "Human",
    ai_prefix = "AI"
  ): string {
    const string_messages: string[] = [];
    for (const m of messages) {
      let role: string;
      if (m._getType() === "human") {
        role = human_prefix;
      } else if (m._getType() === "ai") {
        role = ai_prefix;
      } else if (m._getType() === "system") {
        role = "System";
      } else if (m._getType() === "generic") {
        role = (m as ChatMessage).role;
      } else {
        throw new Error(`Got unsupported message type: ${m}`);
      }
      string_messages.push(`${role}: ${m.text}`);
    }
    return string_messages.join("\n");
  }

  async returnCurrentStack(): Promise<MemoryVariables> {
    return   this.chatHistory.messages
    
  }
  async returnCurrentStackAsString(): Promise<String> {
    return this.getBufferString(this.chatHistory.messages);
  }
  async loadMemoryVariables(_values: InputValues): Promise<MemoryVariables> {

    const result = {
      [this.memoryKey]: this.getBufferString(this.chatHistory.messages)
    };
    
    return result;


    return result;
  }
  async saveContext(
    inputValues: InputValues,
    outputValues: OutputValues
  ): Promise<void> {
     
    inputValues.input && this.chatHistory.addUserMessage(inputValues.input)
    outputValues.text && this.chatHistory.addAIChatMessage(outputValues.text)

  }
}

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
    console.log(formatted)
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
    console.log(text)
    if (text.includes("Final Answer:")) {
      const parts = text.split("Final Answer:");
      const input = parts[parts.length - 1].trim();
      const finalAnswers = { output: input };
      return { log: text, returnValues: finalAnswers };
    }

    const match = /Action: (.*): (.*)/s.exec(text);
    if (!match) {
      return { log: text, returnValues: { output: "How can I help you?" } };
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
  public model?: ChatOpenAI;
  public memory = new CustomMemory()
  systemState: string | undefined;
  tools?: (DynamicTool )[];
  constructor() {
   
    

  }
  getCurrentDate() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
  
    return `${yyyy}/${mm}/${dd}`;
  }
  public async call(input: string, ctx: any) {
    if (this.executor == undefined)
      await this._init()
    
    this.systemState = `today is ${this.getCurrentDate()}. ` 

    let ask = (await this.model!.call([
        new SystemChatMessage(
          `${this.systemState}Categorize the following text, use:

          TASK: the text contain an instruction or a command
          QUESTION: the text is asking for some information
          STATEMENT: the text contains informations but no instructions
          
          answer MUST be one of [TASK, QUESTION, STATEMENT, OTHER]

          text: `
        ),
        new HumanChatMessage(
          input
        ),
      ])).text;
    
      console.log('INPUT CLASSIFIED AS ' + ask)
    switch(ask) {
      case "STATEMENT": 
        this.memory.chatHistory.addUserMessage(input)
      case "OTHER":
        return await this.invokeLLM(input,`${this.systemState}\n${await this.memory.returnCurrentStackAsString()}\nYou are ROBORTA, a helpful and factual chat bot, address yourself as female if needed`)

      case "TASK": 
      case "QUESTION":
        this.memory.chatHistory.addUserMessage(input)
        return await this.invokeAgent(input)
    }

    const response = await this.executor!.call({ input });



    return response.output;
  }
  async invokeAgent(input: string) {
    const toolStrings = this.tools!
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");
    const toolNames = this.tools!.map((tool) => tool.name).join("\n");



    

    let zeroshot = await this.invokeLLM(input, `${this.systemState}\n${await this.memory.returnCurrentStackAsString()}\nYou are ROBORTA, a cautious assistant. address yourself as female if prompted. 

    answer using either
    UNSURE
    or 
    Final answer: the answer for the user
    
    Try to answer the following question:
    `)
    if (zeroshot.startsWith('Final answer: ')){
      zeroshot = zeroshot.replace('Final answer: ','')
      this.memory.chatHistory.addAIChatMessage(zeroshot)
      return zeroshot
    }
    let scratchpad = []

    for (let i=0; i< 10; i++) {
      let text = (await this.invokeLLM(input, `${this.systemState}\n${await this.memory.returnCurrentStackAsString()}\nYou are ROBORTA, a helpful assistant, address yourself as female if prompted. Answer the following questions as best you can. 
      You have access to the following tools:
      
      ${toolStrings}

      Always use the following format:
      
      Question: the sentence you must reply
      Thought: always think what information to look  up to reply to the user, pick the information that has the least uncertainty
      Action: one action to take, should be one of [${toolNames}]
      Action Input: the input to the action
      Observation: the result of the action
      ... (this Thought/Action/Action Input/Observation can repeat N times)
      Thought: I now know the final answer
      Final Answer: the final answer to the original input question, always answer in english
      
      Begin!
      
      
      Question:`))

      if (text.includes("Final Answer:")) {
        const parts = text.split("Final Answer:");
        const answer = parts[parts.length - 1].trim();
        this.memory.chatHistory.addAIChatMessage(answer)
        return answer
      } 
  
      if (text.indexOf('Action:') && text.indexOf('Action Input:') ) {
        let regex = /^Action:(.*)$/m;
        let match = text.match(regex);
        let toolName = match ? match![1].trim() : undefined;
        regex = /^Action Input:(.*)$/m;
        match = text.match(regex);
        let toolInput = match ? match![1].trim() : undefined;
        let observation = `asking ${toolName} for ${toolInput} didn't provide any insight`
        if (toolName && toolInput) {
          for (let t of this.tools!) {
            if (t.name == toolName) {
              try {
              observation = await t.call(toolInput!)
              } catch (e) {
                console.log(e)
              }
              
            }
          }
          
        }
        this.memory.chatHistory.addAIChatMessage('Observation: ' + observation)
        console.log('OBSERVATION: ',observation) 
        continue
      }


    }
    return await this.invokeLLM(input, `${this.systemState}\nYou are ROBORTA, a fussy assistant, address yourself as female if prompted. 

    Don't answer any question and don't perform any task. Someting in the user message is not clear. Ask the user to clarify the message, identify what is not clear.
    
    Message:`)
  }

  async  _init() {

    const configuration = new Configuration({
      apiKey: openAIApiKey, 
    });
    this.model = new ChatOpenAI(params, configuration);

    this.tools = [new GoogleTool(this.model),  new CalculatorTool(this.model)];

    

    const llmChain = new LLMChain({
      prompt: new CustomPromptTemplate({
        tools:this.tools,
        inputVariables: ["input", "agent_scratchpad","chat_history"],
      }),
      llm: this.model,
      memory: this.memory,
    });
  
    const agent = new LLMSingleActionAgent({
      llmChain,
      outputParser: new CustomOutputParser(),
      stop: ["\nObservation"],
    });

    this.executor = new AgentExecutor({
      agent,
      tools: this.tools,
      verbose: false
    });

    
  }
  
  async invokeLLM(input: string, prompt:string) {
    
    let t = (await this.model!.call([
      new SystemChatMessage(
        prompt
      ),
      new HumanChatMessage(
        input
      ),
      ])).text
      console.log("\n\n\nINVOKING ", prompt, "\nINPUT ",input,"\nANSWER", t, "\nEND\n\n");
    return t
  }

}

