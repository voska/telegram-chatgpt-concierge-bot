import { DynamicTool } from "langchain/tools";
import  wiki  from 'wikijs';
import { ChatOpenAI } from "langchain/chat_models";
import { HumanChatMessage, SystemChatMessage } from "langchain/schema";
import { loadQAMapReduceChain } from "langchain/chains";
import { Document } from "langchain/document";


export class WikipediaTool extends DynamicTool {

  constructor(llm: ChatOpenAI, question: string) {
    super({
      name: "Wikipedia",
      description:
        "useful to research historical facts",
      func: async (searchPhrase: string) => {
            
           let searchResults =  JSON.stringify(await wiki().search(searchPhrase));
           let ps = (await llm.call([
            new SystemChatMessage(
              `is there any wikipedia page that can answer this question, only return the page title. answer using either
              UNSURE: why are you unsure
              or 
              Page Title: the title\n\nPages:` + searchPhrase
            ),
            new HumanChatMessage(
                searchResults
            ),
          ])).text;

          if (ps.startsWith('Page Title: ')){
            ps = ps.replace('Page Title: ','') 
            
            searchResults = JSON.stringify(await (await wiki().page(ps)).content())
          

          }
          
          const cr = await llm.call([
            new SystemChatMessage(
              "user had these questions:  \n- " + question + '\n- ' + searchPhrase  +"\n summarize the text and extract relevant information: "
            ),
            new HumanChatMessage(
              searchResults
            ),
          ]);
          return cr.text;
 
      },
    })
  }
}
