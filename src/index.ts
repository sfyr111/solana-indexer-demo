import {
  Connection,
  clusterApiUrl,
  PublicKey,
} from '@solana/web3.js';
import retry from 'retry';
import { config } from 'dotenv';
import { Logger } from './logger';

config();

// 类型定义
interface RaydiumPool {
  id: string;
  baseToken: string;
  quoteToken: string;
}

interface RaydiumPools {
  [key: string]: RaydiumPool;
}

interface TransferInfo {
  amount: number;
  token: string;
}

interface SwapInfo {
  type: string;
  pool: string;
  swapType: string;
  inputAmount: number;
  outputAmount: number;
  timestamp: string;
  transfers: TransferInfo[];
}

interface SlotInfo {
  slot: number;
  parent?: number;
  root?: number;
}

interface Instruction {
  programId: string;
  accounts: string[];
  data: string;
  type?: string;
  discriminator?: string;
}

interface TransactionInfo {
  signature: string;
  slot: number;
  blockTime: string | null;
  programs: string[];
  accounts: string[];
  instructions: Instruction[];
  logs?: string[];
}

interface TokenTransfer {
  token: string;
  from: string;
  to: string;
  amount: number;
  decimals: number;
}

interface SwapDetails {
  type: 'swap';
  inputTransfer: TokenTransfer;
  outputTransfer: TokenTransfer;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

class SolanaIndexer {
  private connection: Connection;
  private lastProcessedSlot: number;
  private watchedPrograms: PublicKey[];
  private debug: boolean;
  private startSlot: number;
  private currentSlot: number;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    // 使用 devnet
    const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
    console.log('使用 RPC 节点:', rpcUrl);
    
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: process.env.SOLANA_WS_URL,
      confirmTransactionInitialTimeout: 60000,
    });

    this.lastProcessedSlot = 0;
    this.watchedPrograms = process.env.WATCH_PROGRAM_IDS
      ? process.env.WATCH_PROGRAM_IDS.split(',').map(id => new PublicKey(id.trim()))
      : [];
        
    if (this.watchedPrograms.length > 0) {
      console.log('监听以下程序:', this.watchedPrograms.map(pk => pk.toBase58()));
    }

    this.debug = process.env.DEBUG === 'true';
    this.startSlot = parseInt(process.env.START_SLOT || '289001565');
    this.currentSlot = this.startSlot;
    
    console.log(`将从区块高度 ${this.startSlot} 开始监听`);
  }

  async start(): Promise<void> {
    console.log('启动 Solana 索引服务...');
    
    const operation = retry.operation({
      retries: 5,
      factor: 2,
      minTimeout: 2000,
      maxTimeout: 10000,
    });

    operation.attempt(async (currentAttempt) => {
      try {
        await this.testConnection();
        console.log(`开始处理区块 ${this.startSlot}...`);
        await this.processHistoricalBlocks();
        this.subscribeToBlocks();
      } catch (error) {
        console.error(`尝试 ${currentAttempt} 失败:`, error instanceof Error ? error.message : String(error));
        if (operation.retry(error as Error)) {
          return;
        }
        console.error('索引服务启动失败，已达到最大重试次数');
        process.exit(1);
      }
    });
  }

  private async testConnection(): Promise<void> {
    try {
      const version = await this.connection.getVersion();
      const slot = await this.connection.getSlot();
      
      console.log('已连接到 Solana 节点:', {
        版本: version['solana-core'],
        当前区块: slot,
        网络: 'devnet'
      });
    } catch (error) {
      throw new Error(`连接测试失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private subscribeToBlocks(): void {
    console.log('开始监听新区块...');

    if (this.debug) {
      this.connection.onSlotUpdate((slotUpdate) => {
        console.log('Slot 更新:', {
          type: slotUpdate.type,
          slot: slotUpdate.slot,
          timestamp: new Date().toISOString()
        });
      });
    }

    const slotSubscriptionId = this.connection.onSlotChange((slotInfo) => {
      this.processNewSlot(slotInfo).catch(error => {
        console.error('处理区块错误:', error.message);
      });
    });

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.connection.getSlot();
        if (this.debug) {
          console.log('连接状态: 正常');
        }
      } catch (error) {
        console.error('连接状态: 异常 -', error instanceof Error ? error.message : String(error));
      }
    }, 30000);

    process.on('SIGINT', () => {
      console.log('正在关闭索引服务...');
      this.connection.removeSlotChangeListener(slotSubscriptionId);
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      process.exit(0);
    });
  }

  private async processHistoricalBlocks(): Promise<void> {
    try {
      const latestSlot = await this.connection.getSlot();
      console.log(`当前最新区块: ${latestSlot}, 开始处理从 ${this.currentSlot} 到 ${latestSlot} 的区块`);

      const BATCH_SIZE = 5;
      const BATCH_DELAY = 3000;

      for (let currentSlot = this.currentSlot; currentSlot <= latestSlot; currentSlot += BATCH_SIZE) {
        const batchEnd = Math.min(currentSlot + BATCH_SIZE - 1, latestSlot);
        console.log(`处理区块批次: ${currentSlot} 到 ${batchEnd}`);

        const promises = [];
        for (let slot = currentSlot; slot <= batchEnd; slot++) {
          promises.push(
            this.processNewSlot({ slot })
              .catch(error => {
                if (!error.message.includes('Block not available')) {
                  console.error(`处理区块 ${slot} 失败:`, error.message);
                }
              })
          );
        }

        await Promise.all(promises);
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));

        if (currentSlot % 100 === 0) {
          const progress = ((currentSlot - this.startSlot) / (latestSlot - this.startSlot) * 100).toFixed(2);
          console.log(`处理进度: ${progress}%`);
        }
      }

      console.log('历史区块处理完成');
    } catch (error) {
      console.error('处理历史区块时发生错误:', error instanceof Error ? error.message : String(error));
    }
  }

  private async processNewSlot(slotInfo: SlotInfo): Promise<void> {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const block = await this.connection.getBlock(slotInfo.slot, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
          transactionDetails: 'full',
          rewards: false,
        });

        if (!block) {
          if (this.debug) {
            console.log(`区块 ${slotInfo.slot} 不可用`);
          }
          return;
        }

        for (const tx of block.transactions) {
          try {
            if (!tx.meta || tx.meta.err) continue;
            if (!tx.transaction || !tx.transaction.message) continue;

            const transaction = tx.transaction;
            const message = transaction.message;
            const accountKeys = message.getAccountKeys();
            
            if (!accountKeys || !message.compiledInstructions) {
              if (this.debug) {
                console.log('跳过不完整的交易数据');
              }
              continue;
            }

            // Logger.logBlockTransactions({
            //   slot: slotInfo.slot,
            //   blockTime: block.blockTime ? new Date(block.blockTime * 1000).toISOString() : null,
            //   transactions: block.transactions.map(tx => ({
            //     signature: tx.transaction.signatures[0],
            //     meta: {
            //       err: tx.meta?.err,
            //       logMessages: tx.meta?.logMessages,
            //       preTokenBalances: tx.meta?.preTokenBalances,
            //       postTokenBalances: tx.meta?.postTokenBalances
            //     },
            //     instructions: tx.transaction.message.compiledInstructions.map(inst => ({
            //       programId: tx.transaction.message.staticAccountKeys[inst.programIdIndex].toBase58(),
            //       data: inst.data  // swap discriminator
            //     }))
            //   }))
            // });
    

            const programIds = new Set<string>();
            message.compiledInstructions.forEach(ix => {
              if (ix.programIdIndex !== undefined) {
                const programId = accountKeys.get(ix.programIdIndex);
                if (programId) {
                  programIds.add(programId.toBase58());
                }
              }
            });

            const relevantPrograms = this.watchedPrograms.length === 0 
              ? Array.from(programIds)
              : Array.from(programIds).filter(programId => 
                this.watchedPrograms.some(watchedId => 
                  watchedId.toBase58() === programId
                )
              );

            if (relevantPrograms.length > 0) {
              const txInfo: TransactionInfo = {
                signature: transaction.signatures[0],
                slot: slotInfo.slot,
                blockTime: block.blockTime ? new Date(block.blockTime * 1000).toISOString() : null,
                programs: relevantPrograms,
                accounts: Array.from({ length: accountKeys.length }, (_, i) => accountKeys.get(i)?.toBase58() || '').filter(Boolean),
                instructions: [],
              };

              const instructions: Instruction[] = [];
              for (const ix of message.compiledInstructions) {
                try {
                  if (ix.programIdIndex === undefined || !ix.accountKeyIndexes || !ix.data) continue;
                  
                  const programId = accountKeys.get(ix.programIdIndex);
                  if (!programId) continue;

                  const instruction: Instruction = {
                    programId: programId.toBase58(),
                    accounts: ix.accountKeyIndexes.map(idx => {
                      const account = accountKeys.get(idx);
                      return account ? account.toBase58() : '';
                    }).filter(Boolean),
                    data: Buffer.from(ix.data).toString('hex'),
                  };

                  if (instruction.programId === process.env.WATCH_PROGRAM_ID && instruction.data) {
                    const dataBuffer = Buffer.from(instruction.data, 'hex');
                    if (dataBuffer.length >= 8) {
                      const discriminator = dataBuffer.slice(0, 8).toString('hex');
                      instruction.type = getRaydiumInstructionType(discriminator);
                      instruction.discriminator = discriminator;
                    }
                  }

                  instructions.push(instruction);
                } catch (error) {
                  if (this.debug) {
                    console.error('解析指令时出错:', error instanceof Error ? error.message : String(error));
                  }
                  continue;
                }
              }

              if (instructions.length > 0) {
                txInfo.instructions = instructions;
                txInfo.logs = tx.meta.logMessages || [];
                console.log('Raydium 交易:', txInfo);

                // 记录交易基础信息
                Logger.logTransaction(txInfo);

                for (const instruction of instructions) {
                  // 记录指令信息
                  Logger.logInstruction({
                    programId: instruction.programId,
                    type: instruction.type,
                    discriminator: instruction.discriminator,
                  });

                  if (instruction.type === 'swap') {
                    // 记录 Swap 指令详情
                    Logger.logDebug({
                      type: 'swap_instruction',
                      discriminator: instruction.discriminator,
                      accounts: instruction.accounts,
                      data: instruction.data,
                    });

                    const swapDetails = await this.parseSwapInstruction(instruction, tx);
                    if (swapDetails) {
                      // 添加代币符号映射
                      const TOKEN_SYMBOLS: { [key: string]: string } = {
                        'So11111111111111111111111111111111111111112': 'SOL',
                        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
                        // '4QGCZU9vto49NwohfTLQd8JA6B49dacpMyNhfFB1W9We': 'USDT',
                      };

                      // 记录 Swap 详情
                      Logger.logSwap({
                        type: swapDetails.type,
                        input: {
                          token: TOKEN_SYMBOLS[swapDetails.inputTransfer.token] || swapDetails.inputTransfer.token,
                          amount: swapDetails.inputTransfer.amount,
                          decimals: swapDetails.inputTransfer.decimals
                        },
                        output: {
                          token: TOKEN_SYMBOLS[swapDetails.outputTransfer.token] || swapDetails.outputTransfer.token,
                          amount: swapDetails.outputTransfer.amount,
                          decimals: swapDetails.outputTransfer.decimals
                        },
                        timestamp: txInfo.blockTime
                      });
                    } else {
                      console.log('无法解析 swap 详情，原因可能是:', {
                        hasPreBalances: Boolean(tx.meta.preTokenBalances),
                        hasPostBalances: Boolean(tx.meta.postTokenBalances),
                        preBalancesLength: tx.meta.preTokenBalances?.length,
                        postBalancesLength: tx.meta.postTokenBalances?.length,
                      });
                    }
                  }
                }
              }

              // 记录代币余额变化
              if (tx.meta.preTokenBalances || tx.meta.postTokenBalances) {
                Logger.logTokenBalances({
                  pre: tx.meta.preTokenBalances,
                  post: tx.meta.postTokenBalances,
                  relevantLogs: tx.meta.logMessages?.filter(log => 
                    log.includes('TransferChecked') || 
                    log.includes('SwapBaseInput')
                  )
                });
              }
            }
          } catch (error) {
            if (this.debug) {
              console.error('处理交易时出错:', error instanceof Error ? error.message : String(error));
            }
            continue;
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('429')) {
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`遇到速率限制，等待 ${delay}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          if (!error.message.includes('Block not available')) {
            console.error(`处理区块 ${slotInfo.slot} 时发生错误:`, error.message);
          }
        }
        throw error;
      }
    }
  }

  private async parseSwapInstruction(instruction: Instruction, tx: any): Promise<SwapDetails | null> {
    try {
      const preBalances = tx.meta.preTokenBalances as TokenBalance[];
      const postBalances = tx.meta.postTokenBalances as TokenBalance[];
      
      if (!preBalances || !postBalances) {
        console.log('没有找到代币余额信息');
        return null;
      }

      // 计算每个代币账户的余额变化
      const balanceChanges = new Map<string, {
        mint: string,
        decimals: number,
        change: number
      }>();

      // 处理前置余额
      preBalances.forEach(pre => {
        balanceChanges.set(pre.mint, {
          mint: pre.mint,
          decimals: pre.uiTokenAmount.decimals,
          change: -Number(pre.uiTokenAmount.amount)
        });
      });

      // 处理后置余额
      postBalances.forEach(post => {
        const existing = balanceChanges.get(post.mint);
        if (existing) {
          existing.change += Number(post.uiTokenAmount.amount);
        } else {
          balanceChanges.set(post.mint, {
            mint: post.mint,
            decimals: post.uiTokenAmount.decimals,
            change: Number(post.uiTokenAmount.amount)
          });
        }
      });

      // 过滤出有实际变化的代币
      const changes = Array.from(balanceChanges.values())
        .filter(x => Math.abs(x.change) > 0);

      console.log('代币余额变化:', changes);

      if (changes.length >= 2) {
        // 按变化金额排序，负数（支出）在前
        changes.sort((a, b) => a.change - b.change);

        // 格式化代币金额的辅助函数
        function formatTokenAmount(amount: number, decimals: number): number {
          const formatted = amount / Math.pow(10, decimals);
          // 限制小数位数为 4 位
          return Number(formatted.toFixed(4));
        }

        return {
          type: 'swap',
          inputTransfer: {
            token: changes[0].mint,
            amount: formatTokenAmount(Math.abs(changes[0].change), changes[0].decimals),
            decimals: changes[0].decimals,
            from: '',
            to: ''
          },
          outputTransfer: {
            token: changes[changes.length - 1].mint,
            amount: formatTokenAmount(changes[changes.length - 1].change, changes[changes.length - 1].decimals),
            decimals: changes[changes.length - 1].decimals,
            from: '',
            to: ''
          }
        };
      }
    } catch (error) {
      console.error('解析 swap 指令失败:', error);
    }
    return null;
  }
}

// Raydium V3 指令类型映射
const RAYDIUM_INSTRUCTION_TYPES: { [key: string]: string } = {
  // Swap 相关
  '8fbe5adac41e33de': 'swap',         // SwapBaseInput
  '45373366584850': 'swap',           // SwapBaseInput (another version)
  'e9337f012d70c0f0': 'swap',         // SwapBaseOutput
  
  // 流动性相关
  'f4c069a1b5f233bc': 'addLiquidity',
  '4a1c3df8fa781539': 'removeLiquidity',
  
  // 其他常见操作
  '0b05a0b39c3cd8ea': 'createPool',
  'd4c69119d8ea3088': 'closePosition',
  'b4c76604d72c58c2': 'openPosition',
  'cd35e4f35f45a845': 'increaseLiquidity',
  'b119a7e3d6c6c2e3': 'decreaseLiquidity'
};

function getRaydiumInstructionType(discriminator: string): string {
  const type = RAYDIUM_INSTRUCTION_TYPES[discriminator];
  if (type) {
    console.log(`识别到 Raydium ${type} 指令, discriminator: ${discriminator}`);
  }
  return type || 'unknown';
}

// 启动索引服务
const indexer = new SolanaIndexer();
indexer.start().catch(console.error);

// 添加更详细的错误处理
process.on('unhandledRejection', (error: Error) => {
  console.error('未处理的 Promise 拒绝:', {
    错误: error.message,
    堆栈: error.stack
  });
});

process.on('uncaughtException', (error: Error) => {
  console.error('未捕获的异常:', {
    错误: error.message,
    堆栈: error.stack
  });
}); 