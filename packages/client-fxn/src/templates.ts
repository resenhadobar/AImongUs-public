import {
    messageCompletionFooter
} from "@ai16z/eliza/src/parsing.ts";

export const directorInitiationTemplate = `
Bio: {{bio}}

Task: Create a random, creative scene opening for a wrestling event. Format as "START: [scene description]". Make it unexpected but believable within wrestling context.
` + messageCompletionFooter;
