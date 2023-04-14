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
          new HumanChatMessage(
            'You are ROBORTA, a user assistant. You have tools at your disposal to research user questions.\nExtract all data related to the scenario and their relationship.'
          ),
          new SystemChatMessage(
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
        ]);
        return cr.text;
      },
    })
  }
}
