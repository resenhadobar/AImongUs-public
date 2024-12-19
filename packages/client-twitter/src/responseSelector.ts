import { generateMessageResponse } from "@ai16z/eliza/src/generation.ts";
import { composeContext } from "@ai16z/eliza/src/context.ts";
import { ModelClass, State, IPerformanceService, ServiceType, IAgentRuntime, Memory } from "@ai16z/eliza/src/types.ts";

export const performanceResponseSelectorFooter = `\nResponse format must be a JSON block:
\`\`\`json
{
    "responseDecision": {
        "shouldSpeak": boolean,
        "confidence": number,
        "passReason": string | null,
        "responseContext": {
            "respondingTo": string | null,
        },
    }
}
\`\`\``;

const performanceResponseSelectorTemplate = `
Recent Messages:
{{recentPerformanceActions}}

As {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}

Check in sequence:
1. Were you directly addressed? If yes -> respond
2. Did someone just talk about your interests/rivals/goals? If yes -> respond
3. Was someone else directly addressed? If yes -> pass
4. Is this an open conversation? -> If yes -> respond
` + performanceResponseSelectorFooter;

export interface PerformanceResponseDecision {
    shouldSpeak: boolean;
    confidence: number;
    passReason: string | null;
    responseContext: {
        respondingTo: string | null;
        relationshipDynamic: string | null;
        emotionalContext: string | null;
    };
    suggestedThemes: string[];
}

// What we return to the TwitterPerformanceClient
export interface SelectorResponse {
    shouldRespond: boolean;
    decision: PerformanceResponseDecision & {
        action: 'TWEET_ACTION'; // Always TWEET_ACTION for message handler compatibility
    };
}

export class PerformanceResponseSelector {
    constructor(private runtime: IAgentRuntime) {}

    private async composeSelectionState(baseState: State): Promise<State> {
        const performanceService = this.runtime.getService<IPerformanceService>(ServiceType.PERFORMANCE);
        if (!performanceService) {
            throw new Error('Performance service not available');
        }

        const currentState = await performanceService.manager.getCurrentState();
        if (!currentState) {
            throw new Error('No active performance state');
        }

        const nextActorNumber = (currentState.actors.current) % currentState.actors.total;

        // Create a dummy memory for state composition
        const dummyMemory: Memory = {
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: baseState.roomId,
            content: {
                text: currentState.currentBeat,
                source: 'performance_selection',
                metadata: {
                    performance: currentState
                }
            }
        };

        // Get full state composition
        const composedState = await this.runtime.composeState(dummyMemory, {
            performanceState: JSON.stringify(currentState, null, 2),
            nextActorNumber,
            characterRole: `Actor ${this.runtime.character.role.order}`,
            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
            currentBeat: currentState.currentBeat,
            messageCount: currentState.messageCount,
            maxTweetCount: currentState.maxTweetCount,
            messagesSinceLastBeat: currentState.messagesSinceLastBeat
        });

        return composedState;
    }

    public async selectResponse(baseState: State): Promise<SelectorResponse> {
        const selectionState = await this.composeSelectionState(baseState);

        const context = composeContext({
            state: selectionState,
            template: performanceResponseSelectorTemplate
        });

        console.log('determining decision based on ', context);

        const response: any = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.SMALL
        });

        console.log('Decision to act was ', response);

        return {
            shouldRespond: response.responseDecision.shouldSpeak,
            decision: {
                ...response.responseDecision,
                action: 'TWEET_ACTION' // Always set for message handler
            }
        };
    }
}
