import { EventEmitter } from "events";
import {
    IAgentRuntime,
} from "@ai16z/eliza/src/types.ts";
import { SolanaAdapter } from 'fxn-protocol-sdk';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import {signMessage} from "./utils/signingUtils.ts";
import {
    createTransferInstruction,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getMint,
    TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";

interface TransferResult {
    signature: string;
    status: 'success' | 'error';
    message?: string;
}


export class FxnClient extends EventEmitter {
    protected runtime: IAgentRuntime;
    private solanaAdapter: SolanaAdapter;

    constructor({ runtime }: { runtime: IAgentRuntime }) {
        super();
        this.runtime = runtime;
        const provider = this.createAnchorProvider();
        this.solanaAdapter = new SolanaAdapter(provider);
    }

    /**
     * todo configure the content format
     * @param content
     * @param subscribers
     * @protected
     */
    public async broadcastToSubscribers(content: any, subscribers: Array<any>) {
        // console.log('Gonna broadcast - subscribers are ', subscribers);
        const promises = subscribers.map(async (subscriber) => {
            try {
                const privateKey = this.runtime.getSetting("WALLET_PRIVATE_KEY")!;
                const privateKeyUint8Array = bs58.decode(privateKey);
                // Create keypair from private key
                const keypair = Keypair.fromSecretKey(privateKeyUint8Array);

                const signedPayload = await signMessage(keypair, content);
                const recipient = subscriber.subscription?.recipient;

                console.log('Subscriber fields are ', recipient, subscriber.status);

                if (recipient && subscriber.status === 'active') {
                    return fetch(recipient, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(signedPayload)
                    });
                }
            } catch (error) {
                console.error(`Failed to broadcast to subscriber`, subscriber, error);
            }
        });

        return Promise.allSettled(promises);
    }

    /**
     * Retrieve the Host's subscriber list from FXN
     * @protected
     */
    public async getSubscribers(): Promise<any[]> {
        const agentId = new PublicKey(this.runtime.getSetting("WALLET_PUBLIC_KEY"));
        return this.solanaAdapter.getSubscriptionsForProvider(agentId);
    }

    /**
     * Creates a mainnet-specific provider for token transfers
     */
    private createMainnetProvider(): AnchorProvider {
        const mainnetRpcUrl = this.runtime.getSetting("MAINNET_RPC_URL");
        const privateKey = this.runtime.getSetting("WALLET_PRIVATE_KEY")!;

        // Convert base58 private key to Uint8Array
        const privateKeyUint8Array = bs58.decode(privateKey);

        // Create keypair from private key
        const keypair = Keypair.fromSecretKey(privateKeyUint8Array);

        // Create mainnet connection using the RPC URL
        const connection = new Connection(mainnetRpcUrl, 'confirmed');

        // Create wallet instance
        const wallet = new Wallet(keypair);

        // Create and return the provider
        return new AnchorProvider(
            connection,
            wallet,
            { commitment: 'confirmed' }
        );
    }

    protected createAnchorProvider(): AnchorProvider {
        const rpcUrl = this.runtime.getSetting("RPC_URL");
        const privateKey = this.runtime.getSetting("WALLET_PRIVATE_KEY")!;

        // Convert base58 private key to Uint8Array
        const privateKeyUint8Array = bs58.decode(privateKey);

        // Create keypair from private key
        const keypair = Keypair.fromSecretKey(privateKeyUint8Array);

        // Create connection using the RPC URL
        const connection = new Connection(rpcUrl, 'confirmed');

        // Create wallet instance
        const wallet = new Wallet(keypair);

        // Create and return the provider
        return new AnchorProvider(
            connection,
            wallet,
            { commitment: 'confirmed' }
        );
    }

    /**
     * Transfer tokens to a recipient on mainnet
     * @param recipientPublicKey - The public key of the reward recipient
     * @param amount - The amount of tokens to transfer (in human-readable format)
     * @returns Promise<TransferResult>
     */
    public async transferRewardTokens(
        recipientPublicKey: string,
        amount: number
    ): Promise<TransferResult> {
        try {
            const rewardTokenCA = this.runtime.getSetting('REWARD_TOKEN_CA');
            if (!rewardTokenCA) {
                throw new Error('Reward token CA not configured');
            }

            // Use mainnet provider instead of default devnet provider
            const mainnetProvider = this.createMainnetProvider();
            const rewardTokenPubKey = new PublicKey(rewardTokenCA);
            const recipientPubKey = new PublicKey(recipientPublicKey);

            // Get token mint info to get decimals
            const mintInfo = await getMint(
                mainnetProvider.connection,
                rewardTokenPubKey
            );

            // Calculate the actual amount with decimals
            const adjustedAmount = amount * Math.pow(10, mintInfo.decimals);

            // Get the associated token accounts
            const fromTokenAccount = await getAssociatedTokenAddress(
                rewardTokenPubKey,
                mainnetProvider.wallet.publicKey
            );

            const toTokenAccount = await getAssociatedTokenAddress(
                rewardTokenPubKey,
                recipientPubKey
            );

            // Create transaction
            const transaction = new Transaction();

            // Check if recipient's token account exists on mainnet
            const recipientAccountInfo = await mainnetProvider.connection.getAccountInfo(toTokenAccount);

            if (!recipientAccountInfo) {
                console.log('Creating associated token account for recipient on mainnet');
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        mainnetProvider.wallet.publicKey,  // payer
                        toTokenAccount,             // ata
                        recipientPubKey,            // owner
                        rewardTokenPubKey           // mint
                    )
                );
            }

            // Add transfer instruction with adjusted amount
            transaction.add(
                createTransferInstruction(
                    fromTokenAccount,
                    toTokenAccount,
                    mainnetProvider.wallet.publicKey,
                    adjustedAmount
                )
            );

            // Send and confirm transaction on mainnet
            const signature = await mainnetProvider.sendAndConfirm(
                transaction,
                [],
                {
                    maxRetries: 3,
                    skipPreflight: true,
                    commitment: 'confirmed',
                }
            );

            return {
                signature,
                status: 'success',
                message: `Successfully transferred ${amount} tokens to ${recipientPublicKey}`
            };

        } catch (error) {
            console.error('Token transfer failed:', error);
            return {
                signature: '',
                status: 'error',
                message: error.message
            };
        }
    }

    protected onReady() {
        throw new Error("onReady not implemented in base class");
    }
}
