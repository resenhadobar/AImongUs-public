import { type State } from "./types.ts";

/**
 * Composes a context string by replacing placeholders in a template with corresponding values from the state.
 *
 * This function takes a template string with placeholders in the format `{{placeholder}}` and a state object.
 * It replaces each placeholder with the value from the state object that matches the placeholder's name.
 * If a matching key is not found in the state object for a given placeholder, the placeholder is replaced with an empty string.
 *
 * @param {Object} params - The parameters for composing the context.
 * @param {State} params.state - The state object containing values to replace the placeholders in the template.
 * @param {string} params.template - The template string containing placeholders to be replaced with state values.
 * @returns {string} The composed context string with placeholders replaced by corresponding state values.
 *
 * @example
 * // Given a state object and a template
 * const state = { userName: "Alice", userAge: 30 };
 * const template = "Hello, {{userName}}! You are {{userAge}} years old";
 *
 * // Composing the context will result in:
 * // "Hello, Alice! You are 30 years old."
 * const context = composeContext({ state, template });
 */
export const composeContext = ({
    state,
    template,
}: {
    state: State;
    template: string;
}) => {
    // @ts-expect-error match isn't working as expected
    const out = template.replace(/{{\w+}}/g, (match) => {
        const key = match.replace(/{{|}}/g, "");
        return state[key] ?? "";
    });
    return out;
};

/**
 * Adds a header to a body of text.
 *
 * This function takes a header string and a body string and returns a new string with the header prepended to the body.
 * If the body string is empty, the header is returned as is.
 *
 * @param {string} header - The header to add to the body.
 * @param {string} body - The body to which to add the header.
 * @returns {string} The body with the header prepended.
 *
 * @example
 * // Given a header and a body
 * const header = "Header";
 * const body = "Body";
 *
 * // Adding the header to the body will result in:
 * // "Header\nBody"
 * const text = addHeader(header, body);
 */
export const addHeader = (header: string, body: string) => {
    return body.length > 0 ? `${header ? header + "\n" : header}${body}\n` : "";
};

export interface FormattedContext {
    text: string;
    importance: number;
}

export class ContextManager {
    private static MAX_CONTEXT_ITEMS = 30;

    /**
     * Formats and limits context items based on importance and recency
     */
    static formatContextItems(items: any[], formatFn: (item: any) => FormattedContext): string {
        // Sort by importance and recency
        const formattedItems = items
            .map(formatFn)
            .sort((a, b) => {
                // First sort by importance
                if (b.importance !== a.importance) {
                    return b.importance - a.importance;
                }
                // Then by recency (assuming newer items are at the end)
                return 1;
            })
            .slice(-this.MAX_CONTEXT_ITEMS) // Keep only the most recent/important items
            .map(item => item.text)
            .join('\n\n');

        return formattedItems;
    }

    /**
     * Formats timeline items (tweets, messages, etc)
     */
    static formatTimeline(items: any[], options: {
        prefix?: string,
        maxItems?: number
    } = {}): string {
        const { prefix = "", maxItems = this.MAX_CONTEXT_ITEMS } = options;

        return prefix + items
            .slice(-maxItems)
            .map((item) => {
                return `ID: ${item.id}\nFrom: ${item.name} (@${item.username})${
                    item.inReplyToStatusId ? ` In reply to: ${item.inReplyToStatusId}` : ""
                }\nText: ${item.text}\n---`;
            })
            .join('\n');
    }

    /**
     * Formats direct messages with importance weighting
     */
    static formatDirectMessages(messages: any[]): string {
        return this.formatContextItems(messages, (msg) => ({
            text: `From: ${msg.name} (@${msg.username})\nMessage: ${msg.text}\n---`,
            // Messages with certain keywords or from specific users could have higher importance
            importance: this.calculateMessageImportance(msg)
        }));
    }

    /**
     * Calculate importance score for a message based on content and metadata
     */
    private static calculateMessageImportance(message: any): number {
        let importance = 1;

        // Keywords that might indicate important messages
        const importantKeywords = ['performance', 'plan', 'decide', 'important', 'urgent'];
        const text = message.text.toLowerCase();

        // Increase importance for messages containing key terms
        if (importantKeywords.some(keyword => text.includes(keyword))) {
            importance += 1;
        }

        // More recent messages are more important
        if (message.timestamp && Date.now() - message.timestamp < 24 * 60 * 60 * 1000) {
            importance += 1;
        }

        return importance;
    }
}
