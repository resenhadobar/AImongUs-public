// packages/direct-client/src/index.ts
import express from 'express';
import bodyParser from 'body-parser';
import {IAgentRuntime} from '@ai16z/eliza/src/types.ts';
import {WordAileManager} from "./wordAileManager.ts";
import {FxnClient} from "./fxnClient.ts";
import path from "path";
import fs from 'fs/promises';
import {fileURLToPath} from "url";
import {verifyMessage} from "./utils/signingUtils.ts";
import {generateText, ModelClass} from "@ai16z/eliza";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FxnClientInterface {
    private app: express.Express;
    private gameManager: WordAileManager;
    private fxnClient: FxnClient;
    private templateCache: string | null = null;

    constructor(private runtime: IAgentRuntime) {
        this.app = express();
        this.app.use(bodyParser.json());

        const role = this.runtime.getSetting("FXN_ROLE");
        console.log('FXN Role is ', role);
        if (role) {
            this.setupGame(role);
        }
    }

    private setupGame(role: string) {
        if (role === 'PLAYER') {
            this.setupRoutes();
        }
        if (role === 'HOST') {
            this.fxnClient = new FxnClient({ runtime: this.runtime });
            this.setupGameLoop();
            this.setupHostRoutes();
        }
        const port = this.runtime.getSetting("SERVER_PORT") || 3000;
        this.app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    }

    private async loadTemplate(): Promise<string> {
        if (this.templateCache) return this.templateCache;

        const templatePath = path.join(__dirname, 'templates', 'host-view.html');
        this.templateCache = await fs.readFile(templatePath, 'utf8');
        return this.templateCache;
    }

    private generateBoardStateHTML(publicKey: string, boardState: any): string {
        const rows = [];
        const results = this.gameManager.getPlayerHistory(publicKey);
        for (let i = 0; i < 5; i++) {
            const guess = boardState.guesses[i] || '';
            const feedback = boardState.feedback[i] || '';

            const squares = [];
            for (let j = 0; j < 5; j++) {
                let bgColor = 'bg-gray-900';
                let borderColor = 'border-purple-500/20';
                let shadow = '';

                if (feedback[j] === '🟩') {
                    bgColor = 'bg-pink-600';
                    borderColor = 'border-pink-400';
                    shadow = 'shadow-lg shadow-pink-500/20';
                } else if (feedback[j] === '🟨') {
                    bgColor = 'bg-purple-600';
                    borderColor = 'border-purple-400';
                    shadow = 'shadow-lg shadow-purple-500/20';
                } else if (guess[j]) {
                    bgColor = 'bg-gray-800';
                    borderColor = 'border-purple-500/20';
                }

                squares.push(`
                <div class="grid-square ${shadow}" data-pos="${i}-${j}">
                    <div class="grid-square-front bg-gray-900 rounded-lg border border-purple-500/20">
                        ${guess[j] || ''}
                    </div>
                    <div class="grid-square-back ${bgColor} rounded-lg border ${borderColor}">
                        ${guess[j] || ''}
                    </div>
                </div>
            `);
            }
            rows.push(`
            <div class="flex gap-2 justify-center" data-row="${i}">
                ${squares.join('')}
            </div>
        `);
        }

        const resultIndicator = `        <div class="result-indicator">
            ${this.generateResultMarks(results)}        </div>`;

        return `        <div class="bg-gradient-to-br from-purple-900/30 to-pink-900/30 p-8 rounded-2xl backdrop-blur-lg border border-purple-500/20 relative"
             data-round-start="${this.gameManager.getCurrentRoundStartTime()}"
             data-round-duration="${this.gameManager.ROUND_DURATION}">
            <div class="flex items-center flex-row justify-between gap-3 mb-6">
                <div class="flex flex-row items-center gap-2">
                    <div class="h-3 w-3 rounded-full bg-pink-500 animate-pulse"></div>
                    <h2 class="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500" data-pubkey="${this.formatPublicKey(publicKey)}">
                        ${this.formatPublicKey(publicKey)}                    </h2>
                </div>
                ${resultIndicator}            </div>
            <div class="grid gap-2">
                ${rows.join('')}            </div>
        </div>
    `;
    }

    formatPublicKey(publicKey: string): string {
        if (!publicKey || publicKey.length < 8) return publicKey;
        return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
    }

    private generateResultMarks(results: boolean[]): string {
        if (!results || !Array.isArray(results)) return '';

        const recentResults = results.slice(-6);

        return recentResults.map(result => {
            if (result) {
                // Checkmark for wins
                return `                <span class="result-mark win-mark" title="Won">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                </span>`;
            } else {
                // X mark for losses
                return `                <span class="result-mark loss-mark" title="Lost">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </span>`;
            }
        }).join('');
    }

    private setupHostRoutes() {
        this.app.get('/', async (req, res) => {
            try {
                const template = await this.loadTemplate();
                const boardStates = Array.from(this.gameManager.getAllBoardStates().entries());
                const lastWord = this.gameManager.getLastWord() || 'None';
                const hostPublicKey = this.runtime.getSetting("WALLET_PUBLIC_KEY");
                const roundStartTime = this.gameManager.getCurrentRoundStartTime();
                const roundDuration = this.gameManager.getRoundDuration();
                const lastWinner = this.gameManager.getLastWinner() || 'None'
                const roundNumber = this.gameManager.getRoundNumber();
                const playerCount = await this.gameManager.getPlayerCount();


                const boardStateHTML = boardStates.map(([publicKey, state]) =>
                    this.generateBoardStateHTML(publicKey, state)
                ).join('');

                const renderedTemplate = template
                    .replace('<!-- BOARD_STATES_PLACEHOLDER -->', boardStateHTML)
                    .replace('${lastWord}', `${lastWord}`)
                    .replace('${roundStartTime}', roundStartTime.toString())
                    .replace('${roundDuration}', roundDuration.toString())
                    .replace('${lastWinner}', this.formatPublicKey(lastWinner))
                    .replace('${formatPublicKey(hostPublicKey)}', this.formatPublicKey(hostPublicKey))
                    .replace('${roundNumber}', roundNumber.toString())
                    .replace('${playerCount}', playerCount.toString());

                res.send(renderedTemplate);
            } catch (error) {
                console.error('Error serving host view:', error);
                res.status(500).send('Internal Server Error');
            }
        });
        this.app.get('/api/winners', async (req, res) => {
            try {
                const history = await this.gameManager.loadWinnerHistory();
                res.json(history);
            } catch (error) {
                console.error('Error serving winners:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });
    }

    /**
     * Initiate the wordAIle game
     * Ensure your Host agent is registered on FXN as a data provider
     * @private
     */
    private async setupGameLoop() {
        this.gameManager = new WordAileManager(this.fxnClient);
    }

    /**
     * Receive the latest round and route it to the performance client
     * @private
     */
    private setupRoutes() {
        console.log('Setting up routes for player');
        const handleRequest = async (req: any, res: any) => {
            try {
                const { publicKey, signature, payload } = req.body;

                // Add debug logging
                console.log('Received POST request:', {
                    path: req.path,
                    body: req.body,
                    headers: req.headers
                });

                console.log('board is', req.body);

                // Get the game master's public key
                const gameMasterKey = this.runtime.getSetting("GAME_MASTER_KEY");

                // Verify that the message came from the game master
                const verificationResult = await verifyMessage({
                    payload,
                    signature,
                    publicKey: gameMasterKey
                });

                if (!verificationResult.isValid) {
                    return res.status(401).json({
                        error: 'Invalid signature',
                        details: 'Message signature verification failed'
                    });
                }

                // Generate the guess based on board state
                const guess = await this.generateWordleGuess(payload.boardState);

                // Send this player's guess back
                res.json({ guess });

            } catch (error) {
                console.error('Error processing request:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    details: error.message
                });
            }
        };

        // Register the handler for both paths
        this.app.post('/', handleRequest);
        this.app.post('', handleRequest);
    }

    private createWordlePrompt(boardState: { guesses: string[], feedback: string[] }): string {
        let prompt = `You are playing Wordle. Generate a single 5-letter word as your next guess based on the following information:

Previous guesses and their feedback:
`;

        for (let i = 0; i < boardState.guesses.length; i++) {
            prompt += `Guess ${i + 1}: ${boardState.guesses[i]} - Feedback: ${boardState.feedback[i]}\n`;
        }

        prompt += `
Feedback Key:
🟩 = Letter is correct and in the right position
🟨 = Letter is in the word but in the wrong position
⬜ = Letter is not in the word

Rules:
1. Must be a common 5-letter English word
2. Use the feedback from previous guesses to make an informed choice
3. Only provide the word, nothing else
4. Do not reuse words that have already been guessed
5. If there is no information on the board, return a random 5 letter word

Your next guess:`;

        return prompt;
    }

    private validateGuess(guess: string): boolean {
        return Boolean(
            guess &&
            guess.length === 5 &&
            /^[a-z]+$/.test(guess)
        );
    }

    private async generateWordleGuess(boardState: { guesses: string[], feedback: string[] }): Promise<string> {
        // Create the prompt
        const prompt = this.createWordlePrompt(boardState);

        // Generate a guess using the language model
        const rawGuess = await generateText({
            runtime: this.runtime,
            context: prompt,
            modelClass: ModelClass.SMALL,
            stop: null
        });

        // Clean up the guess
        const cleanGuess = rawGuess.trim().toLowerCase();

        // Validate the guess
        if (!this.validateGuess(cleanGuess)) {
            console.error('Invalid guess generated:', cleanGuess);
            throw new Error('Generated guess does not meet Wordle requirements');
        }

        return cleanGuess;
    }

    static async start(runtime: IAgentRuntime) {
        console.log('Starting FXN Client');
        return new FxnClientInterface(runtime);
    }

    async stop() {
        // Cleanup code if needed
        console.log('Stopping direct client');
    }
}
