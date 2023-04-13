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
  modelName: "gpt-4",
  maxConcurrency: 1,
  maxTokens: 2000,
  maxRetries: 5,
  frequencyPenalty: 0,
  presencePenalty: 0
};



class CustomMemory extends BufferMemory {
  constructor() {
    super({ memoryKey: "chat_history" });
  }

  getBufferString = function(
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


    let prompt = `${this.systemState}
You are ROBORTA, a helpful assistant, address yourself as female if prompted. Answer the following questions as best you can. 
  
You have access to the following tools:
    
${toolStrings}

Use the following format (action and action input are useful only to retrieve facts that you don't already know):

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${toolNames}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

${history}

Question: 


`

console.log(prompt)
console.log(input)


    for (let i=0; i< 10; i++) {
      let text = (await this.invokeLLM(input, prompt,true))

  
      if (text.indexOf('Action:')>-1 && text.indexOf('Action Input:')>-1 ) {
        let regex = /Action:(.*)$/m;
        let match = text.match(regex);
        let toolName = match ? match![1].trim() : undefined;
        regex = /Action Input:(.*)$/m;
        match = text.match(regex);
        let toolInput = match ? match![1].trim() : undefined;
        let observation = `asking ${toolName} for ${toolInput} didn't provide any insight`

        if (toolName && toolInput) {
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
        }
        
        let delta = '\n' + text.replace(/(Action Input:([^\n\r]*)).*/s,'$1') + '\nObservation: ' + observation
        input = input + delta

        

        continue
      }

      if (text.includes("Final Answer:")) {
        const parts = text.split("Final Answer:");
        console.log(text)
        const answer = parts[parts.length - 1].trim();
        return answer
      } 

    }
    return await this.invokeLLM(input, `${this.systemState}\nYou are ROBORTA, a fussy assistant, address yourself as female if prompted. 

    Don't answer any question and don't perform any task. Someting in the user message is not clear. Ask the user to clarify the message, identify what is not clear.
    
    Message:`)
  }


  async invokeLLM(input: string, prompt:string, premium: boolean = false) {
    
    let t = (await this.model.call([
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

}

