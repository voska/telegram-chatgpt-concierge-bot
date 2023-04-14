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
  AIChatMessage,
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
import { WikipediaTool } from "./tools/wikipedia";

const openAIApiKey = process.env.OPENAI_API_KEY!;

const params = {
  verbose: true,
  temperature: 1.0,
  openAIApiKey,
  modelName: "gpt-3.5-turbo",
  maxConcurrency: 1,
  maxTokens: 2000,
  maxRetries: 5,
  frequencyPenalty: 0,
  presencePenalty: 0
};

const premium_params = {
  verbose: true,
  temperature: 1.0,
  openAIApiKey,
  modelName: "gpt-3.5-turbo",
  maxConcurrency: 1,
  maxTokens: 2000,
  maxRetries: 5,
  frequencyPenalty: 0,
  presencePenalty: 0
};

const getBufferString = function(
  messages: BaseChatMessage[],
  human_prefix = "Me",
  ai_prefix = "ROBORTA"
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

class CustomMemory extends BufferMemory {
  constructor() {
    super({ memoryKey: "chat_history" });
  }



  async returnCurrentStack(): Promise<MemoryVariables> {
    return   this.chatHistory.messages
    
  }
  async returnCurrentStackAsString(): Promise<String> {
    return getBufferString(this.chatHistory.messages);
  }
  async loadMemoryVariables(_values: InputValues): Promise<MemoryVariables> {

    const result = {
      [this.memoryKey]: getBufferString(this.chatHistory.messages)
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




const configuration = new Configuration({
  apiKey: openAIApiKey, 
});


export class Model {

  public executor?: AgentExecutor;
  public model = new ChatOpenAI(params, configuration);
  public model_premium = new ChatOpenAI(premium_params, configuration);;
  public memory = new CustomMemory()
  systemState: string | undefined;
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

    try{
    this.systemState = `today is ${this.getCurrentDate()}. ` 

    input await this.invokeLLM(input, 'Rewrite this sentence in english, separating the scenario from the questions and the tasks in this sentence:')

    let ask = (await this.invokeLLM(
          input,
          `${this.systemState}Categorize the following text, use:

          FORGET: this is a order to forget our conversation so far
          TASK: the text contain an instruction or a command
          QUESTION: the text is asking for some information
          STATEMENT: the text contains informations but no instructions
          

          answer MUST be one of [FORGET, TASK, QUESTION, STATEMENT, OTHER]

          text: `)).replace(/[^A-Z]/g, "");;
    
      
      
    
      if (ask.indexOf("FORGET")>-1) {
        this.memory = new CustomMemory();
        return 'Alright, let me know if you need any assistance or have any questions.'

      } 
      if (ask.indexOf("STATEMENT")>-1) {
        this.memory.chatHistory.addUserMessage(input)
      } 
      
      if (ask.indexOf("QUESTION")>-1 || ask.indexOf("TASK")>-1) {
        
        let text = await this.invokeAgent(input)
        if (text) {
        this.memory.chatHistory.addUserMessage(input)
        this.memory.chatHistory.addAIChatMessage(text)
        return text
        }
        else return "I'm having difficulties answering right now."
        
      }

      return await this.invokeLLM(input,
`${this.systemState}\n
You are ROBORTA, a helpful and factual chat bot, address yourself as female if needed. 
This was our conversation so far:\n${await this.memory.returnCurrentStackAsString()}
Human: `
        )

   
    

   } catch(e) {
      console.log(e)
      return JSON.stringify(e);
    }
  }
  async invokeAgent(input: string) {
    let tools =  [new GoogleTool(this.model, input), new WikipediaTool(this.model, input)];
    const toolStrings = tools!
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");
    const toolNames = tools!.map((tool) => tool.name).join("\n");


    console.log("ENTERING AGENT")
    let history = this.memory.chatHistory.messages.length? 
    `This was our conversation so far:\n${await this.memory.returnCurrentStackAsString()}, the question may be related.`:``

    



    let request = history +'\n'+input

    let prompt = `${this.systemState}
You are ROBORTA, a precise assistant, address yourself as female if prompted, follow the user request as best as you can. 

You have access to the following tools, these tool are very simple and can only explore one entity or one relationship at a time:

${toolStrings}

Use tools to clarify the entities until all entities in the scenario are clear. answer in this format:

Action: one action to take, should be one of [${toolNames}]
Action Input: one entity or one relationship to research

`


    let discover_chain:BaseChatMessage[] =   []
    let answer_chain:BaseChatMessage[] =   []

    answer_chain.push(new SystemChatMessage(`${this.systemState}
      You are ROBORTA, a precise assistant, address yourself as female if prompted, answer as best as you can. `))
    answer_chain.push(new HumanChatMessage(request))


    discover_chain.push(new SystemChatMessage(prompt))
    discover_chain.push(new HumanChatMessage(request))
    let toolInputs:string[] = []
    for (let i=0; i< 10; i++) {
      let text = (await this.invokeLLMComplex(discover_chain,true))
      discover_chain.push(new AIChatMessage(text))
  
      if (text.indexOf('Action:')>-1 && text.indexOf('Action Input:')>-1 ) {
        let regex = /Action:(.*)$/m;
        let match = text.match(regex);
        let toolName = match ? match![1].trim() : undefined;
        regex = /Action Input:(.*)$/m;
        match = text.match(regex);
        let toolInput = match ? match![1].trim() : undefined;
        let observation = `asking ${toolName} for ${toolInput} didn't provide any insight`
        
        if (toolName && toolInput) {
          if ((toolName+toolInput) in toolInputs) {
              discover_chain.push(new HumanChatMessage("Observation: Nothing new can be discovered from this tool" ))
              continue;
            }
            toolInputs.push(toolName+toolInput)
            for (let t of tools!) {
              if (t.name == toolName) {
                try {
                observation = await t.call(toolInput!)

                } catch (e) {
                  console.log(e)
                }
                
              }
            }
            console.log("TOOL RESULT FROM " , toolName,":" ,toolInput ," -> ", observation)
            discover_chain.push(new HumanChatMessage("Observation: " + observation))
            answer_chain.push(new AIChatMessage("Observation: " + observation))
            continue
          }
      
      }

      return (await this.invokeLLMComplex(answer_chain,true))   

    }

    return await this.invokeLLM(input, `${this.systemState}\nYou are ROBORTA, a fussy assistant, address yourself as female if prompted. 

    Don't answer any question and don't perform any task. Someting in the user message is not clear. Ask the user to clarify the message, identify what is not clear.
    
    Message:`)
  }



  async invokeLLM(input: string, prompt:string, premium: boolean = false) {
    let m = premium? this.model_premium : this.model
    let t = (await m.call([
      new SystemChatMessage(
        prompt
      ),
      new HumanChatMessage(
        input
      ),
      ])).text
    
    console.log('EXECUTING LLM\n',prompt,input,'\nRESULT\n',t,'\nGENERATION END')

    return t
  }
  async invokeLLMComplex(messages: BaseChatMessage[], premium: boolean = false) {
    
    let m = premium? this.model_premium : this.model
    let t = (await m.call(messages)).text

    console.log('EXECUTING LLM\n', getBufferString(messages) ,'\nRESULT\n',t,'\nGENERATION END')


    return t
  }

}

