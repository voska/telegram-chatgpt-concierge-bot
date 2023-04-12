import { DynamicTool } from "langchain/tools";
import { Parser } from "expr-eval";
import google from "googlethis";
import { ChatOpenAI } from "langchain/chat_models";
import { HumanChatMessage, SystemChatMessage } from "langchain/schema";


export class CalculatorTool extends DynamicTool {

  constructor(llm: ChatOpenAI, question: string) {
    super({
      name: "Calculator",
      description:
        "useful to execute small javascript mathematical expressions",
      func: async (input: string) => {
        try {  
          const regex = /[\d+\-*/.()]+/g;
          const matches = input.match(regex);
          return Parser.evaluate(matches ? matches.join("") : "").toString();
        } catch (error) {
          return "I don't know how to do that.";
        }
      },
    })
  }
}
