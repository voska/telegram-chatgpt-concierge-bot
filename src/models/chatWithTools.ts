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
  maxTokens: 1000,
  maxRetries: 5,
};

const premium_params = {
  verbose: true,
  temperature: 1.0,
  openAIApiKey,
  modelName: "gpt-4",
  maxConcurrency: 1,
  maxTokens: 4000,
  maxRetries: 5,
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
  tools = [new GoogleTool(this.model),  new CalculatorTool(this.model), new WikipediaTool(this.model)];
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

    let ask = (await this.model.call([
        new SystemChatMessage(
          `${this.systemState}Categorize the following text, use:

          FORGET: this is a order to forget our conversation so far
          TASK: the text contain an instruction or a command
          QUESTION: the text is asking for some information
          STATEMENT: the text contains informations but no instructions
          

          answer MUST be one of [FORGET, TASK, QUESTION, STATEMENT, OTHER]

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
      case "FORGET":
        this.memory = new CustomMemory();
        return 'Alright, let me know if you need any assistance or have any questions.'
      case "OTHER":
      deafult:
        return await this.invokeLLM(input,
`${this.systemState}\n
You are ROBORTA, a helpful and factual chat bot, address yourself as female if needed. 
This was our conversation so far:\n${await this.memory.returnCurrentStackAsString()}
Human: `
        )

      case "TASK": 
      case "QUESTION":
        let text = await this.invokeAgent(input)
        this.memory.chatHistory.addUserMessage(input)
        this.memory.chatHistory.addAIChatMessage(text)
        return text

    }

   } catch(e) {
      console.log(e)
      return JSON.stringify(e);
    }
  }
  async invokeAgent(input: string) {
    const toolStrings = this.tools!
    .map((tool) => `${tool.name}: ${tool.description}`)
    .join("\n");
    const toolNames = this.tools!.map((tool) => tool.name).join("\n");



    console.log("ENTERING AGENT")

    let zeroshot = await this.invokeLLM(input, 
`${this.systemState}
You are ROBORTA, a cautious assistant. address yourself as female if prompted. 

answer using either
UNSURE: why are you unsure
or 
Final answer: the factual answer 

This was our conversation so far:\n${await this.memory.returnCurrentStackAsString()} 

Try to answer the following question:
`, true)
    if (zeroshot && zeroshot.startsWith('Final answer: ')){
      zeroshot = zeroshot.replace('Final answer: ','')
      return zeroshot
    }
    console.log("MODEL UNSURE, STARTING LOOP")
    let history = this.memory.chatHistory.messages.length? 
    `This was our conversation so far:\n${await this.memory.returnCurrentStackAsString()}, the question may be related.`:``


    let prompt = `${this.systemState}
You are ROBORTA, a helpful assistant, address yourself as female if prompted. Answer the following questions as best you can. 


This was our conversation so far: ${await this.memory.returnCurrentStackAsString()} 
  
  
This was our conversation so far: ${await this.memory.returnCurrentStackAsString()} 
  
You have access to the following tools:
    
${toolStrings}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${toolNames}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!



Question: 
${history}

`





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
        console.log('TOOL: ',toolName,toolInput) 
        if (toolName && toolInput) {
          for (let t of this.tools!) {
            if (t.name == toolName) {
              try {
              observation = await t.call(toolInput!)
              console.log('TOOL: ',toolName,toolInput, "->",observation) 
              } catch (e) {
                console.log(e)
              }
              
            }
          }
          
        }
        
        console.log('OBSERVATION: ',observation) 

        input = input + '\n' + text.replace(/(Action Input:([^\n\r]*)).*/s,'$1') + '\nObservation: ' + observation

        console.log('TWEAKED INPUT AT ITERATION : ',i,input) 

        continue
      }

      if (text.includes("Final Answer:")) {
        const parts = text.split("Final Answer:");
        const answer = parts[parts.length - 1].trim();
        return answer
      } 

    }
    return await this.invokeLLM(input, `${this.systemState}\nYou are ROBORTA, a fussy assistant, address yourself as female if prompted. 

    Don't answer any question and don't perform any task. Someting in the user message is not clear. Ask the user to clarify the message, identify what is not clear.
    
    Message:`)
  }


  async invokeLLM(input: string, prompt:string, premium: boolean = false) {
    
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

