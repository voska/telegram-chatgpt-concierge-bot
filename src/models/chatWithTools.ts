import { AgentExecutor } from "langchain/agents";
import { ChatOpenAI } from "langchain/chat_models";
import {
  InputValues,
  BaseChatMessage,
  HumanChatMessage,
  SystemChatMessage,
  AIChatMessage,
  ChatMessage,
} from "langchain/schema";
import { BufferMemory  } from "langchain/memory";
import { Configuration } from "openai";
import { GoogleTool } from "./tools/google";
import { MemoryVariables, OutputValues } from "langchain/dist/memory/base";
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
  human_prefix = "User",
  ai_prefix = "ROBORTA",
  generic_prefix = "Observe"
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
      role = generic_prefix;
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
    string_messages.push(`${role}: ${m.text}`);
  }
  return string_messages.join("\n");
}


const getHistoryAsObservations = function(messages: BaseChatMessage[]) {
  const string_messages: string[] = [];
  for (const m of messages) {
    string_messages.push(`Observation: ${m.text}`);
  }
  return string_messages.join("\n");
}
class CustomMemory extends BufferMemory {
  llm: ChatOpenAI;
  constructor(llm:ChatOpenAI) {
    super({ memoryKey: "chat_history" });
    this.llm = llm;
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

 async addMessage(message: ChatMessage) {
    this.chatHistory.messages.push()
    
    let restOfArray = this.chatHistory.messages.slice(0, -4);
    const lastThreeElements = this.chatHistory.messages.slice(-4);
    if (restOfArray.length>0) {
      restOfArray.push(new HumanChatMessage('Summarize all our conversation so far'))
      restOfArray.push(new AIChatMessage('This is a summary of all our previous conversations:'))
      let summary = new AIChatMessage((await this.llm.call(restOfArray)).text);
      restOfArray = restOfArray.filter(e=> {return false})
      restOfArray.push(summary)
      restOfArray.concat(lastThreeElements)
      this.chatHistory.messages = restOfArray
    }


  }

}




const configuration = new Configuration({
  apiKey: openAIApiKey, 
});


export class Model {

  public executor?: AgentExecutor;
  public model = new ChatOpenAI(params, configuration);
  public model_premium = new ChatOpenAI(premium_params, configuration);;
  public memory = new CustomMemory(this.model)
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
    this.systemState = `Today is ${this.getCurrentDate()} and you can use tools to get new information.` 

    console.log("\n\n\nINVOKING CATEGORIZATION")
    let ask = (await this.invokeLLMComplex([

          new HumanChatMessage(
          
          `${this.systemState}Categorize the following text, use:

          FORGET: this is a order to forget our conversation so far
          TASK: the text contain an instruction or a command
          QUESTION: the text is asking for some information
          STATEMENT: the text contains informations but no instructions
          

          answer MUST be one of [FORGET, TASK, QUESTION, STATEMENT, OTHER]

          text: `), new AIChatMessage(input)])).toLocaleUpperCase();
    
      
      
    
      if (ask.indexOf("FORGET")>-1) {
        this.memory = new CustomMemory(this.model);
        console.log("\n\n\nINVOKING CLEANUP RESPONSE")
        return await this.invokeLLMComplex([
          new SystemChatMessage(`${this.systemState}\n
          You are ROBORTA, a helpful and factual chat bot, address yourself as female if needed. 
          Greet the user.`)]
        )

      } 
      if (ask.indexOf("STATEMENT")>-1) {
        this.memory.chatHistory.messages.push(new ChatMessage(input, "Observation: "))
      } 
      
      if (ask.indexOf("QUESTION")>-1 || ask.indexOf("TASK")>-1) {
        
        let text = await this.invokeAgent(input)
        if (text) {
        this.memory.chatHistory.addUserMessage(input)
        this.memory.chatHistory.addAIChatMessage(text)
        return text
        }
        console.log("\n\n\nINVOKING APOLOGY")
        return await this.invokeLLMComplex([
          new SystemChatMessage(`${this.systemState}\n
          You are ROBORTA, a helpful and factual chat bot, address yourself as female if needed. 
          The system had an issue, write a polite apology.`)]
        )
        
      }
      console.log("\n\n\nINVOKING CHITCHAT")
      return await this.invokeLLMComplex([
        new SystemChatMessage(`${this.systemState}\n
        You are ROBORTA, a helpful and factual chat bot, address yourself as female if needed. 
        This was our conversation so far:`),
        new SystemChatMessage(getHistoryAsObservations(this.memory.chatHistory.messages)),
        new HumanChatMessage(input)
      ])

   
    

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
You are ROBORTA, a precise assistant, address yourself as female if prompted, follow the user request as best as you can. 

You have access to the following tools, these tool are very simple and can only explore one entity or one relationship at a time:

${toolStrings}

Always answer in this format:

Thought: list the ambiguous or underpsecified entities to research. 
Action: one action to take, should be one of [${toolNames}]
Action Input: one entity or one relationship to research
Observe: the data from the tool
...(repeat N time until all entities in the user scenario are clear)

Begin!
`


    let discover_chain:BaseChatMessage[] =   []
    let answer_chain:BaseChatMessage[] =   []

   
    
    answer_chain.push(new SystemChatMessage(`${this.systemState}
      You are ROBORTA, a precise assistant, address yourself as female if prompted, answer as best as you can. You have access to the following tools, these tool are very simple and can only explore one entity or one relationship at a time:

      ${toolStrings}

      Answer in english.
      `))
    answer_chain.push(new SystemChatMessage(getHistoryAsObservations(this.memory.chatHistory.messages)))  
    


    discover_chain.push(new SystemChatMessage(prompt))

    discover_chain.push(new SystemChatMessage(getHistoryAsObservations(this.memory.chatHistory.messages)))  
    input
     
    console.log("\n\n\nINVOKING EXTRACTION")
    discover_chain.push(new HumanChatMessage( (await this.invokeLLMComplex(
      [ new HumanChatMessage('Extract the scenario from the following sentence, answer in english:'),
        new AIChatMessage(input)]) )))

    let toolInputs:string[] = []
    for (let i=0; i< 10; i++) {
      console.log("\n\n\nINVOKING LOOP")
      discover_chain.push(new AIChatMessage('Thought:'))
      let text = (await this.invokeLLMComplex(discover_chain,true,['Observe:']))
      text = text.replace(/'Observe:.*/s,'')

  
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
              discover_chain.push(new HumanChatMessage("Observe: Nothing new can be discovered from this tool" ))
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
            discover_chain.push(new AIChatMessage(text))
            discover_chain.push(new AIChatMessage("Observation: " + observation))
            answer_chain.push(new SystemChatMessage("Observation: " + observation))
            continue
          }
      
      }
      console.log("\n\n\nINVOKING ANSWER CLEANUP")
      answer_chain.push(new HumanChatMessage( input) )
      answer_chain.push(new HumanChatMessage( 'Answer in english') )
      text =  (await this.invokeLLMComplex(answer_chain,true))   
      return text;

    }

    console.log("\n\n\nINVOKING TASK CLARIFICAITON")

    return await this.invokeLLMComplex([ new HumanChatMessage( `${this.systemState}\nYou are ROBORTA, a fussy assistant, address yourself as female if prompted. 

    Don't answer any question and don't perform any task. Someting in the user message is not clear. Ask the user to clarify the message, identify what is not clear.
    
    Message:`), new HumanChatMessage(input)]);
  }



  async invokeLLMComplex(messages: BaseChatMessage[], premium: boolean = false, stops: string[]=[]) {
    
    let m = premium? this.model_premium : this.model
    let t = ''
    if (stops.length>0)
      t = (await m.call(messages,stops)).text
    else
      t = (await m.call(messages)).text

    console.log('EXECUTING LLM\n', getBufferString(messages) ,'\nRESULT\n',t,'\nGENERATION END')


    return t
  }

}

