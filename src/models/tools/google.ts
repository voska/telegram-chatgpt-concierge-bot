import { DynamicTool } from "langchain/tools";
import google from "googlethis";
import { ChatOpenAI } from "langchain/chat_models";
import { AIChatMessage, HumanChatMessage, SystemChatMessage } from "langchain/schema";


export class GoogleTool extends DynamicTool {

  constructor(llm: ChatOpenAI, question: string) {
    super({
      name: "Google",
      description:
        "useful to search internet",
      func: async (searchPhrase: string) => {
        const response = await google.search(searchPhrase, {
          page: 0,
          safe: false, // Safe Search
          parse_ads: false, // If set to true sponsored results will be parsed
          additional_params: {
            // add additional parameters here, see https://moz.com/blog/the-ultimate-guide-to-the-google-search-parameters and https://www.seoquake.com/blog/google-search-param/
          },
        });
    

        const cr = await llm.call([
          new SystemChatMessage (
            'You are ROBORTA, a user assistant. You have tools at your disposal to research user questions.\nAnswer the question with the data provided.'
          ),
          new HumanChatMessage(
            question
          ),
          new AIChatMessage(
            'Search ' + this.name + ': ' + searchPhrase
          ),
          new AIChatMessage(
            'Observe: ' +JSON.stringify({
              response
            })
          ),
          new AIChatMessage(
            'Answer:'
          ),
        ]);
        return cr.text;
      },
    })
  }
}
