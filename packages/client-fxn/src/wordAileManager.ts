import {FxnClient} from "./fxnClient.ts";
import fs from 'fs/promises';
import path from 'path';

import wordList from './utils/words.ts';

interface BoardState {
    guesses: string[];
    feedback: string[];
    guessCount: number;      // Track number of guesses (0-5)
    isComplete: boolean;     // Player has either won or used all guesses
    wonRound: boolean;       // Whether player won this round
}

interface WinnerRecord {
    publicKey: string;
    wins: number;
    timestamp: number;
    transactionHash?: string;
}

interface WinnerHistory {
    winners: WinnerRecord[];
}

interface GameState {
    currentWord: string;
    lastWord: string | null;
    roundStartTime: number;
    boardStates: Map<string, BoardState>;
    winners: Map<string, number>;  // Track wins per player
    roundWinners: Set<string>;  // Track winners for current round
    isActive: boolean;
    roundNumber: number;
    participants: Set<string>;
}

export class WordAileManager {
    private gameState: GameState;
    public readonly ROUND_DURATION = 60 * 1000;  // 5 minutes per round
    private readonly GUESS_DURATION = 10 * 1000;      // 10 seconds between guesses
    private readonly MAX_GUESSES = 5;
    private readonly WINS_NEEDED = 3;
    private roundTimer: NodeJS.Timeout | null = null;
    private guessTimer: NodeJS.Timeout | null = null;
    private readonly WINNERS_FILE_PATH = path.join(process.cwd(), 'game-winners.json');
    private lastWinner: string | null = null;


    constructor(private fxnClient: FxnClient) {
        this.gameState = this.initializeGameState();
        this.startRoundTimer().then(r => {
            console.log('Game Master initialized');
        });
    }
    public async loadWinnerHistory(): Promise<WinnerHistory> {
        try {
            const data = await fs.readFile(this.WINNERS_FILE_PATH, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // If file doesn't exist or is invalid, return empty history
            return { winners: [] };
        }
    }

    private async saveWinner(publicKey: string, wins: number, transactionHash: string) {
        try {
            const history = await this.loadWinnerHistory();
            history.winners.push({
                publicKey,
                wins,
                timestamp: Date.now(),
                transactionHash
            });
            await fs.writeFile(this.WINNERS_FILE_PATH, JSON.stringify(history, null, 2));
        } catch (error) {
            console.error('Error saving winner:', error);
            throw error;
        }
    }

    private initializeGameState(): GameState {
        return {
            currentWord: this.selectRandomWord(),
            roundStartTime: Date.now(),
            lastWord: null,
            boardStates: new Map(),
            winners: new Map(),
            roundWinners: new Set(),
            isActive: true,
            roundNumber: 1,
            participants: new Set()
        };
    }

    private selectRandomWord(): string {
        const wordIndex = Math.floor(Math.random() * (wordList.length)) + 1;
        return wordList[wordIndex];
    }

    private async startRoundTimer() {
        if (this.roundTimer) {
            clearTimeout(this.roundTimer);
        }

        // Start new guess cycle
        await this.startGuessCycle();

        // Set timer for round end
        this.roundTimer = setTimeout(() => this.startNewRound(), this.ROUND_DURATION);
    }

    public async handleGuess(publicKey: string, guess: string): Promise<{
        boardState: BoardState,
        roundOver: boolean,
        gameOver: boolean,
        winner?: string
    }> {
        console.log('Handling guess', guess, publicKey);

        let boardState = this.gameState.boardStates.get(publicKey);
        if (!boardState) {
            boardState = this.initializeBoardState();
            this.gameState.boardStates.set(publicKey, boardState);
        }

        // Check if player can still make guesses
        if (boardState.isComplete || boardState.guessCount >= this.MAX_GUESSES) {
            return {
                boardState,
                roundOver: false,
                gameOver: false
            };
        }

        // Process guess and get feedback
        const feedback = this.checkGuess(guess);
        boardState.guesses.push(guess);
        boardState.feedback.push(feedback);
        boardState.guessCount++;

        // Check if player won with this guess
        const isWinner = feedback === '🟩🟩🟩🟩🟩';
        console.log('isWinner?', isWinner);
        if (isWinner) {
            boardState.wonRound = true;
            boardState.isComplete = true;
            console.log('adding winner', publicKey);
            this.gameState.roundWinners.add(publicKey);  // Add to round winners
        } else if (boardState.guessCount >= this.MAX_GUESSES) {
            // Player used all guesses without winning
            boardState.isComplete = true;
        }

        // Update the state
        this.gameState.boardStates.set(publicKey, boardState);

        const allPlayersOutOfGuesses = this.areAllPlayersOutOfGuesses();
        if (allPlayersOutOfGuesses) {
            // Start new round since no one can guess anymore
            await this.startNewRound();
            return {
                boardState,
                roundOver: true,
                gameOver: false
            };
        }

        return {
            boardState,
            roundOver: false,
            gameOver: false
        };
    }


    private checkGuess(guess: string): string {
        let feedback = '';
        for (let i = 0; i < guess.length; i++) {
            if (guess[i] === this.gameState.currentWord[i]) {
                feedback += '🟩';
            } else if (this.gameState.currentWord.includes(guess[i])) {
                feedback += '🟨';
            } else {
                feedback += '⬜';
            }
        }
        return feedback;
    }

    private async startGuessCycle() {
        if (this.guessTimer) {
            clearTimeout(this.guessTimer);
        }

        await this.broadcastRound();

        // Set timer for next guess cycle
        this.guessTimer = setTimeout(() => this.startGuessCycle(), this.GUESS_DURATION);
    }

    private initializeBoardState(): BoardState {
        return {
            guesses: [],
            feedback: [],
            guessCount: 0,
            isComplete: false,
            wonRound: false
        };
    }

    private async startNewRound() {
        // Update the last word
        this.gameState.lastWord = this.gameState.currentWord;

        // First, update all winners' scores
        console.log('round winners are ', this.gameState.roundWinners);
        this.gameState.roundWinners.forEach(publicKey => {
            const currentWins = (this.gameState.winners.get(publicKey) || 0) + 1;
            this.gameState.winners.set(publicKey, currentWins);
        });

        console.log('global winners are ', this.gameState.winners);
        // Now check for game end condition
        const playersWithMaxWins = Array.from(this.gameState.winners.entries())
            .filter(([_, wins]) => wins >= this.WINS_NEEDED);

        // If we have players with enough wins, check for a clear winner
        if (playersWithMaxWins.length > 0) {
            // Find the highest win count
            const maxWins = Math.max(...playersWithMaxWins.map(([_, wins]) => wins));
            // Get all players with the highest win count
            const winners = playersWithMaxWins.filter(([_, wins]) => wins === maxWins);

            // If there's exactly one winner with the highest score, end the game
            if (winners.length === 1) {
                await this.endGame(winners[0][0]); // winners[0][0] is the publicKey
                return;
            }
            // Otherwise (if there's a tie), continue to the next round
        }

        // Reset for new round
        this.gameState.currentWord = this.selectRandomWord();
        this.gameState.roundStartTime = Date.now();
        this.gameState.roundNumber++;
        this.gameState.roundWinners.clear();

        // Reset board states for new round
        this.gameState.boardStates.forEach((_, publicKey) => {
            this.gameState.boardStates.set(publicKey, this.initializeBoardState());
        });

        await this.startRoundTimer();
    }

    private areAllPlayersOutOfGuesses(): boolean {
        // If there are no board states, return false
        if (this.gameState.boardStates.size === 0) {
            return false;
        }

        // Check if all players have either:
        // 1. Used all their guesses, or
        // 2. Completed their game (won or lost)
        return Array.from(this.gameState.boardStates.values()).every(
            boardState => boardState.isComplete || boardState.guessCount >= this.MAX_GUESSES
        );
    }

    public getCurrentRoundStartTime(): number {
        return this.gameState.roundStartTime;
    }

    private async broadcastRound() {
        const subscribers = await this.fxnClient.getSubscribers();
        console.log('Current board states before broadcast:',
            Array.from(this.gameState.boardStates.entries())
                .map(([key, value]) => ({
                    key,
                    guesses: value.guesses,
                    feedback: value.feedback
                }))
        );

        const promises = subscribers.map(async (subscriber) => {
            try {
                const publicKey = subscriber.subscriber.toString();
                const recipient = subscriber.subscription?.recipient;
                const currentBoardState = this.getBoardState(publicKey);

                // Only check if the subscriber is active
                if (recipient && subscriber.status === 'active') {
                    // Always broadcast the state, but only accept new guesses if the board isn't complete
                    const response = await this.fxnClient.broadcastToSubscribers({
                        boardState: currentBoardState,
                        roundNumber: this.gameState.roundNumber
                    }, subscribers);

                    console.log('Broadcast response is ', response);

                    // Only process new guesses if the board isn't complete
                    if (!currentBoardState.isComplete &&
                        currentBoardState.guessCount < this.MAX_GUESSES &&
                        response &&
                        response[0]['value'] &&
                        response[0]['value']['ok']) {
                        const responseData = await response[0]['value'].json();
                        const guess = responseData.guess;

                        if (guess && typeof guess === 'string' && guess.length === 5) {
                            await this.handleGuess(publicKey, guess);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error communicating with subscriber:`, error);
            }
        });

        await Promise.all(promises);
    }


    private async endGame(winnerPubKey: string) {
        if (this.roundTimer) {
            clearTimeout(this.roundTimer);
        }
        const wins = this.gameState.winners.get(winnerPubKey) || 0;
        this.lastWinner = winnerPubKey;

        try {
            // First distribute the reward
            const rewardResult = await this.distributeReward(winnerPubKey);
            if (rewardResult.status === 'error') {
                console.log('Error distributing reward:', rewardResult.message);
            }

            // Then save the winner with the transaction hash
            await this.saveWinner(winnerPubKey, wins, rewardResult.signature);

            // Start a new game
            await this.startNewGame();
        } catch (error) {
            console.error('Error in endGame:', error);
            // Don't rethrow - just log and continue with new game
            await this.startNewGame();
        }
    }

    private async startNewGame() {
        // Reset game state
        this.gameState = this.initializeGameState();

        // Start the timers again
        await this.startRoundTimer();

        console.log('New game started');
    }

    private async distributeReward(winnerPubKey: string) {
        try {
            const result = await this.fxnClient.transferRewardTokens(winnerPubKey, 20);

            if (result.status === 'error') {
                return {status: 'error', message: `Failed to distribute reward: ${result.message}`, signature: ''};
            }

            console.log(`Reward distribution successful: ${result.message}`);
            return result;
        } catch (error) {
            console.error(`Error distributing reward to ${winnerPubKey}:`, error);
            return {status: 'error', message: `Failed to distribute reward: ${error}`, signature: ''};
        }
    }

    public getBoardState(publicKey: string): BoardState {
        return this.gameState.boardStates.get(publicKey) || this.initializeBoardState();
    }

    public getAllBoardStates(): Map<string, BoardState> {
        return this.gameState.boardStates;
    }

    public getLastWord(): string | null {
        return this.gameState.lastWord;
    }

    public getPlayerHistory(publicKey: string): boolean[] {
        const totalRounds = this.gameState.roundNumber - 1; // Current round number minus 1
        const wins = this.gameState.winners.get(publicKey) || 0;
        const losses = totalRounds - wins;

        // Create an array of results based on wins and losses
        const results: boolean[] = [];
        for (let i = 0; i < wins; i++) results.push(true);
        for (let i = 0; i < losses; i++) results.push(false);

        return results;
    }

    public getRoundDuration(): number {
        return this.ROUND_DURATION;
    }

    public getLastWinner(): string | null {
        return this.lastWinner;
    }

    public getRoundNumber(): number {
        return this.gameState.roundNumber;
    }

    public async getPlayerCount(): Promise<number> {
        const subscribers = await this.fxnClient.getSubscribers();
        return subscribers.filter(sub => sub.status === 'active').length;
    }
}
