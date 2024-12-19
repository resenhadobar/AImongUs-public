use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer as SplTransfer};
use anchor_spl::associated_token::get_associated_token_address;

declare_id!("AnPhQYFcJEPBG2JTrvaNne85rXufC1Q97bu29YaWvKDs");

const MIN_SUBSCRIPTION_PERIOD: i64 = 86400; // 1 day in seconds
const MAX_QUALITY_RECORDS: usize = 10;

#[program]
pub mod subscription_manager {
    use anchor_spl::token;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.owner = ctx.accounts.owner.key();
        state.nft_program_id = ctx.accounts.nft_program.key();
        state.payment_spl_token = ctx.accounts.payment_spl_token.key();
        state.fee_per_day = 1;
        state.collector_fee = 1;
        Ok(())
    }

    // Subscribe function
    pub fn subscribe(
        ctx: Context<Subscribe>,
        recipient: String,
        end_time: i64,
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        let subscriber = &ctx.accounts.subscriber;
        let data_provider = &ctx.accounts.data_provider;
        let dp_token_account = &ctx.accounts.nft_token_account;
        let dp_payment_to_ata = &ctx.accounts.data_provider_payment_ata;
        let owner_payment_to_ata = &ctx.accounts.owner_payment_ata;
        let subscriber_payment_from_ata = &ctx.accounts.subscriber_payment_ata;

        // Validate NFT ownership
        let expected_token_account = get_associated_token_address(
            &data_provider.key(),
            &state.nft_program_id,
        );

        require!(
            dp_token_account.key() == expected_token_account,
            SubscriptionError::InvalidTokenAccount
        );

        require!(
            dp_token_account.owner == data_provider.key(),
            SubscriptionError::InvalidNFTHolder
        );

        require!(
            dp_token_account.amount > 0,
            SubscriptionError::InvalidNFTHolder
        );


        // Validate subscription period
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            end_time >= current_time + MIN_SUBSCRIPTION_PERIOD,
            SubscriptionError::PeriodTooShort
        );

        // Calculate fees
        let duration = end_time - current_time;
        let provider_fee = (duration * state.fee_per_day as i64) / MIN_SUBSCRIPTION_PERIOD;

        // Transfer Fees
        let cpi_accounts_to_owner = SplTransfer {
            from: subscriber_payment_from_ata.to_account_info().clone(),
            to: owner_payment_to_ata.to_account_info().clone(),
            authority: subscriber.to_account_info().clone(),
        };
        let cpi_accounts_to_provider = SplTransfer {
            from: subscriber_payment_from_ata.to_account_info().clone(),
            to: dp_payment_to_ata.to_account_info().clone(),
            authority: subscriber.to_account_info().clone(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();

        // Transfer to owner
        token::transfer(
            CpiContext::new(cpi_program.clone(), cpi_accounts_to_owner),
            state.collector_fee,
        )?;
        token::transfer(
            CpiContext::new(cpi_program, cpi_accounts_to_provider),
            provider_fee as u64,
        )?;


        // Create subscription
        let subscription = &mut ctx.accounts.subscription;
        subscription.end_time = end_time;
        subscription.recipient = recipient.clone();

        // Add to subscribers list
        let subscribers_list = &mut ctx.accounts.subscribers_list;
        subscribers_list.subscribers.push(subscriber.key());

        emit!(SubscriptionCreatedEvent {
            data_provider: data_provider.key(),
            subscriber: subscriber.key(),
            recipient: recipient.clone(),
            end_time,
            timestamp: current_time,
        });

        Ok(())
    }

    pub fn renew_subscription(
        ctx: Context<RenewSubscription>,
        new_recipient: String,
        new_end_time: i64,
        quality: u8,
    ) -> Result<()> {
        // Validate quality rating
        require!(quality <= 100, SubscriptionError::QualityOutOfRange);

        let subscription = &mut ctx.accounts.subscription;
        let state = &ctx.accounts.state;
        let current_time = Clock::get()?.unix_timestamp;

        // Verify subscription exists (non-zero end time indicates existence)
        require!(subscription.end_time > 0, SubscriptionError::SubscriptionNotFound);

        // Calculate renewal time
        let renewal_time = if subscription.end_time > current_time {
            subscription.end_time
        } else {
            current_time
        };

        // Validate new subscription period
        require!(
            new_end_time >= renewal_time + MIN_SUBSCRIPTION_PERIOD,
            SubscriptionError::PeriodTooShort
        );

        // Calculate fees
        let extended_duration = new_end_time - renewal_time;
        let additional_fee = (extended_duration * state.fee_per_day as i64) / MIN_SUBSCRIPTION_PERIOD;

        // Transfer fees
        let transfer_to_owner = anchor_lang::system_program::Transfer {
            from: ctx.accounts.subscriber.to_account_info(),
            to: ctx.accounts.owner.to_account_info(),
        };
        let transfer_to_provider = anchor_lang::system_program::Transfer {
            from: ctx.accounts.subscriber.to_account_info(),
            to: ctx.accounts.data_provider.to_account_info(),
        };

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                transfer_to_owner,
            ),
            state.collector_fee,
        )?;

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                transfer_to_provider,
            ),
            additional_fee as u64,
        )?;

        // Store quality rating
        let current_index = ctx.accounts.quality_info.current_index as usize;
        let subscriber_key = ctx.accounts.subscriber.key();
        ctx.accounts.quality_info.qualities[current_index] = QualityRecord {
            provider: subscriber_key,
            quality: quality
        };
        ctx.accounts.quality_info.current_index = ((current_index as u8) + 1) % MAX_QUALITY_RECORDS as u8;

        // Update subscription
        subscription.end_time = new_end_time;
        subscription.recipient = new_recipient.clone();

        emit!(SubscriptionRenewedEvent {
            data_provider: ctx.accounts.data_provider.key(),
            subscriber: ctx.accounts.subscriber.key(),
            new_recipient,
            new_end_time,
            timestamp: current_time,
        });

        Ok(())
    }

    pub fn cancel_subscription(
        ctx: Context<CancelSubscription>,
        quality: u8,
    ) -> Result<()> {
        // Validate quality rating
        require!(quality <= 100, SubscriptionError::QualityOutOfRange);

        let subscription = &mut ctx.accounts.subscription;
        let current_time = Clock::get()?.unix_timestamp;

        // Verify subscription exists and hasn't ended
        require!(subscription.end_time > 0, SubscriptionError::SubscriptionNotFound);
        require!(
            current_time < subscription.end_time,
            SubscriptionError::SubscriptionAlreadyEnded
        );

        // Store quality rating
        let quality_info = &mut ctx.accounts.quality_info;
        let current_idx = quality_info.current_index as usize;
        quality_info.qualities[current_idx] = QualityRecord {
            provider: ctx.accounts.subscriber.key(),
            quality: quality
        };
        quality_info.current_index = (current_idx as u8 + 1) % MAX_QUALITY_RECORDS as u8;

        // Clear subscription
        subscription.recipient = String::new();
        subscription.end_time = 0;

        emit!(SubscriptionCancelledEvent {
            data_provider: ctx.accounts.data_provider.key(),
            subscriber: ctx.accounts.subscriber.key(),
        });

        Ok(())
    }

    pub fn end_subscription(
        ctx: Context<EndSubscription>,
        quality: u8,
    ) -> Result<()> {
        // Validate quality rating
        require!(quality <= 100, SubscriptionError::QualityOutOfRange);

        let subscription = &mut ctx.accounts.subscription;
        let current_time = Clock::get()?.unix_timestamp;

        // Verify subscription exists
        require!(subscription.end_time > 0, SubscriptionError::SubscriptionNotFound);

        // Verify subscription has ended
        require!(
            current_time >= subscription.end_time,
            SubscriptionError::ActiveSubscription
        );

        // Store quality rating
        let quality_info = &mut ctx.accounts.quality_info;
        let current_idx = quality_info.current_index as usize;
        quality_info.qualities[current_idx] = QualityRecord {
            provider: ctx.accounts.subscriber.key(),
            quality: quality
        };
        quality_info.current_index = (current_idx as u8 + 1) % MAX_QUALITY_RECORDS as u8;

        // Clear subscription
        subscription.recipient = String::new();
        subscription.end_time = 0;

        emit!(SubscriptionEndedEvent {
            data_provider: ctx.accounts.data_provider.key(),
            subscriber: ctx.accounts.subscriber.key(),
        });

        Ok(())
    }

    pub fn set_fee_per_day(
        ctx: Context<AdminFunction>,
        new_fee: u64
    ) -> Result<()> {
        // Get mutable reference to state account
        let state = &mut ctx.accounts.state;

        // Update the fee
        state.fee_per_day = new_fee;

        // Emit the event
        emit!(FeePerDayUpdatedEvent {
            new_fee_per_day: new_fee,
        });

        Ok(())
    }

    pub fn set_collector_fee(
        ctx: Context<AdminFunction>,
        new_fee: u64
    ) -> Result<()> {
        // Get mutable reference to state account
        let state = &mut ctx.accounts.state;

        // Update the fee
        state.collector_fee = new_fee;

        // Emit the event
        emit!(CollectorFeeUpdatedEvent {
            new_collector_fee: new_fee,
        });

        Ok(())
    }

    // Helper function to store quality data
    pub fn store_data_quality(
        ctx: Context<StoreQuality>,
        quality: u8
    ) -> Result<()> {
        // Validate quality rating
        require!(quality <= 100, SubscriptionError::QualityOutOfRange);

        // Get mutable reference to quality info account
        let quality_info = &mut ctx.accounts.quality_info;

        // Store the current index in a local variable
        let current_idx = quality_info.current_index as usize;

        // Store the new quality rating
        quality_info.qualities[current_idx] = QualityRecord {
            provider: ctx.accounts.subscriber.key(),
            quality
        };

        // Update the current index using modulo for circular buffer
        quality_info.current_index =
            (current_idx as u8 + 1) % MAX_QUALITY_RECORDS as u8;

        // Emit the quality provided event
        emit!(QualityProvidedEvent {
            data_provider: ctx.accounts.data_provider.key(),
            subscriber: ctx.accounts.subscriber.key(),
            quality,
        });

        Ok(())
    }

    pub fn get_subscribers(ctx: Context<GetSubscribers>) -> Result<Vec<Pubkey>> {
        Ok(ctx.accounts.subscribers_list.subscribers.clone())
    }

    pub fn initialize_quality_info(ctx: Context<InitializeQualityInfo>) -> Result<()> {
        let quality_info = &mut ctx.accounts.quality_info;
        quality_info.current_index = 0;
        quality_info.subscriber = Pubkey::default();
        quality_info.quality = 0;

        // Initialize the qualities vector with default values
        quality_info.qualities = vec![
            QualityRecord {
                provider: Pubkey::default(),
                quality: 0
            };  // (Pubkey, quality) default pair
            MAX_QUALITY_RECORDS      // Create MAX_QUALITY_RECORDS number of entries
        ];

        Ok(())
    }

}

// Account structures
#[account]
pub struct State {
    pub owner: Pubkey,
    pub nft_program_id: Pubkey,
    pub payment_spl_token: Pubkey,
    pub fee_per_day: u64,
    pub collector_fee: u64,
}

impl State {
    pub const SIZE: usize = 32 + 32 + 8 + 8; // 2 Pubkeys (32 bytes each) + 2 u64s (8 bytes each)
}

#[account]
pub struct Subscription {
    pub end_time: i64,
    pub recipient: String,
}

impl Subscription {
    pub const SIZE: usize = 8 + 32; // i64 (8 bytes) + String (estimated 32 bytes)
}

#[account]
pub struct SubscribersList {
    pub subscribers: Vec<Pubkey>,
}

impl SubscribersList {
    pub const SIZE: usize = 4 + (32 * 10); // Vec length (4 bytes) + space for 10 Pubkeys (32 bytes each)
}

#[account]
#[derive(Default)]
pub struct QualityInfo {
    pub subscriber: Pubkey,          // 32 bytes
    pub quality: u8,                 // 1 byte
    pub current_index: u8,           // 1 byte
    pub qualities: Vec<QualityRecord> // Using our new struct instead of tuple
}

impl QualityInfo {
    pub const MAX_QUALITY_RECORDS: usize = 10; // Define max records for space calculation

    pub const SIZE: usize = 8 +  // discriminator
                           32 +  // subscriber pubkey
                           1 +   // quality
                           1 +   // current_index
                           4 +   // vec length
                           (Self::MAX_QUALITY_RECORDS * (32 + 1)); // qualities array size
}

// Context structs for instructions
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + State::SIZE,
        seeds = [b"storage"],
        bump
    )]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: This is the NFT program ID
    pub nft_program: UncheckedAccount<'info>,
    /// CHECK: SPL token account for payment
    pub payment_spl_token: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(mut)]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub subscriber: Signer<'info>,
    /// CHECK: Data provider account
    #[account(mut)]
    pub data_provider: UncheckedAccount<'info>,
    #[account(
        init,
        payer = subscriber,
        space = 8 + Subscription::SIZE,
        seeds = [b"subscription", subscriber.key().as_ref(), data_provider.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        init_if_needed,
        payer = subscriber,
        space = 8 + SubscribersList::SIZE,
        seeds = [b"subscribers", data_provider.key().as_ref()],
        bump
    )]
    pub subscribers_list: Account<'info, SubscribersList>,
    /// CHECK: Owner account from state
    #[account(mut, constraint = owner.key() == state.owner)]
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub data_provider_payment_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub subscriber_payment_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_payment_ata: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    // Add token program and token account validations for NFT check
    pub token_program: Program<'info, Token>,
    pub nft_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct RenewSubscription<'info> {
    #[account(mut)]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub subscriber: Signer<'info>,
    /// CHECK: Data provider account
    #[account(mut)]
    pub data_provider: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"subscription", subscriber.key().as_ref(), data_provider.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        mut,
        seeds = [b"quality", data_provider.key().as_ref()],
        bump
    )]
    pub quality_info: Account<'info, QualityInfo>,
    /// CHECK: Owner account from state
    #[account(mut, constraint = owner.key() == state.owner)]
    pub owner: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub nft_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(mut)]
    pub subscriber: Signer<'info>,
    /// CHECK: Data provider account
    pub data_provider: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"subscription", subscriber.key().as_ref(), data_provider.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        mut,
        seeds = [b"quality", data_provider.key().as_ref()],
        bump
    )]
    pub quality_info: Account<'info, QualityInfo>,
    pub token_program: Program<'info, Token>,
    pub nft_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct EndSubscription<'info> {
    #[account(mut)]
    pub subscriber: Signer<'info>,
    /// CHECK: Data provider account
    pub data_provider: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"subscription", subscriber.key().as_ref(), data_provider.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        mut,
        seeds = [b"quality", data_provider.key().as_ref()],
        bump
    )]
    pub quality_info: Account<'info, QualityInfo>,
}

#[derive(Accounts)]
pub struct GetSubscribers<'info> {
    /// CHECK: Data provider account
    pub data_provider: UncheckedAccount<'info>,
    #[account(
        seeds = [b"subscribers", data_provider.key().as_ref()],
        bump
    )]
    pub subscribers_list: Account<'info, SubscribersList>,
}

// Context struct for admin functions
#[derive(Accounts)]
pub struct AdminFunction<'info> {
    #[account(
        mut,
        constraint = state.owner == owner.key() @ SubscriptionError::NotOwner
    )]
    pub state: Account<'info, State>,

    #[account(
        signer,
        constraint = owner.key() == state.owner @ SubscriptionError::NotOwner
    )]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct StoreDataQuality<'info> {
    #[account(mut)]
    pub subscriber: Signer<'info>,
    /// CHECK: Data provider account
    pub data_provider: AccountInfo<'info>,
    #[account(mut, seeds = [b"quality", data_provider.key().as_ref()], bump)]
    pub quality_info: Account<'info, QualityInfo>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

// Context struct for storing quality data
#[derive(Accounts)]
pub struct StoreQuality<'info> {
    #[account(mut)]
    pub subscriber: Signer<'info>,

    /// CHECK: Data provider account
    pub data_provider: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"quality", data_provider.key().as_ref()],
        bump
    )]
    pub quality_info: Account<'info, QualityInfo>,
}

#[derive(Accounts)]
pub struct InitializeQualityInfo<'info> {
    #[account(
        init,
        payer = payer,
        // Calculate space for: discriminator + subscriber pubkey + quality + current_index + qualities vec
        space = 8 + 32 + 1 + 1 + 4 + (MAX_QUALITY_RECORDS * (32 + 1)),
        seeds = [b"quality", data_provider.key().as_ref()],
        bump
    )]
    pub quality_info: Account<'info, QualityInfo>,

    /// CHECK: Data provider account is just used as a seed for PDA
    pub data_provider: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct QualityRecord {
    pub provider: Pubkey,
    pub quality: u8,
}


// Events
#[event]
pub struct SubscriptionCreatedEvent {
    pub data_provider: Pubkey,
    pub subscriber: Pubkey,
    pub recipient: String,
    pub end_time: i64,
    pub timestamp: i64,
}

#[event]
pub struct SubscriptionRenewedEvent {
    pub data_provider: Pubkey,
    pub subscriber: Pubkey,
    pub new_recipient: String,
    pub new_end_time: i64,
    pub timestamp: i64,
}

#[event]
pub struct SubscriptionCancelledEvent {
    pub data_provider: Pubkey,
    pub subscriber: Pubkey,
}

#[event]
pub struct SubscriptionEndedEvent {
    pub data_provider: Pubkey,
    pub subscriber: Pubkey,
}

#[event]
pub struct FeePerDayUpdatedEvent {
    pub new_fee_per_day: u64,
}

#[event]
pub struct CollectorFeeUpdatedEvent {
    pub new_collector_fee: u64,
}

#[event]
pub struct QualityProvidedEvent {
    pub data_provider: Pubkey,
    pub subscriber: Pubkey,
    pub quality: u8,
}

// Error definitions
#[error_code]
pub enum SubscriptionError {
    #[msg("Subscription period is too short")]
    PeriodTooShort,
    #[msg("Already subscribed")]
    AlreadySubscribed,
    #[msg("Insufficient payment")]
    InsufficientPayment,
    #[msg("Invalid Token Account")]
    InvalidTokenAccount,
    #[msg("Invalid NFT holder")]
    InvalidNFTHolder,
    #[msg("Subscription not found")]
    SubscriptionNotFound,
    #[msg("Quality out of range")]
    QualityOutOfRange,
    #[msg("Subscription has already ended")]
    SubscriptionAlreadyEnded,
    #[msg("Subscription is still active")]
    ActiveSubscription,
    #[msg("Not the contract owner")]
    NotOwner,
}
