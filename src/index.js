const { Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const retry = require('retry');
require('dotenv').config();

class SolanaIndexer {
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

        // 添加要监听的程序 ID
        this.watchedPrograms = process.env.WATCH_PROGRAM_IDS
            ? process.env.WATCH_PROGRAM_IDS.split(',').map(id => new PublicKey(id.trim()))
            : [];
            
        if (this.watchedPrograms.length > 0) {
            console.log('监听以下程序:', this.watchedPrograms.map(pk => pk.toBase58()));
        }

        // 添加调试模式标志
        this.debug = process.env.DEBUG === 'true';

        // 设置起始区块
        this.startSlot = parseInt(process.env.START_SLOT || '289001565');
        this.currentSlot = this.startSlot;
        
        console.log(`将从区块高度 ${this.startSlot} 开始监听`);
    }

    async start() {
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
                
                // 从指定区块开始处理
                console.log(`开始处理区块 ${this.startSlot}...`);
                await this.processHistoricalBlocks();
                
                // 然后开始监听新区块
                this.subscribeToBlocks();
            } catch (error) {
                console.error(`尝试 ${currentAttempt} 失败:`, error.message);
                if (operation.retry(error)) {
                    return;
                }
                console.error('索引服务启动失败，已达到最大重试次数');
                process.exit(1);
            }
        });
    }

    async testConnection() {
        try {
            const version = await this.connection.getVersion();
            const slot = await this.connection.getSlot();
            
            console.log('已连接到 Solana 节点:', {
                版本: version['solana-core'],
                当前区块: slot,
                网络: 'devnet'
            });
        } catch (error) {
            throw new Error(`连接测试失败: ${error.message}`);
        }
    }

    subscribeToBlocks() {
        console.log('开始监听新区块...');

        // 移除 slot 更新通知监听，改为可选的调试输出
        if (this.debug) {
            this.connection.onSlotUpdate((slotUpdate) => {
                console.log('Slot 更新:', {
                    type: slotUpdate.type,
                    slot: slotUpdate.slot,
                    timestamp: new Date().toISOString()
                });
            });
        }

        // 简化 slot 变更监听的输出
        const slotSubscriptionId = this.connection.onSlotChange((slotInfo) => {
            this.processNewSlot(slotInfo).catch(error => {
                console.error('处理区块错误:', error.message);
            });
        });

        // 修改健康检查日志
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.connection.getSlot();
                // 只在调试模式下输出健康检查信息
                if (this.debug) {
                    console.log('连接状态: 正常');
                }
            } catch (error) {
                console.error('连接状态: 异常 -', error.message);
            }
        }, 30000);

        // 添加错误处理
        process.on('SIGINT', () => {
            console.log('正在关闭索引服务...');
            this.connection.removeSlotChangeListener(slotSubscriptionId);
            clearInterval(this.healthCheckInterval);
            process.exit(0);
        });
    }

    async processHistoricalBlocks() {
        try {
            const latestSlot = await this.connection.getSlot();
            console.log(`当前最新区块: ${latestSlot}, 开始处理从 ${this.currentSlot} 到 ${latestSlot} 的区块`);

            // 减小批处理大小，增加延迟以适应 devnet
            const BATCH_SIZE = 5;  // 减小批次大小
            const BATCH_DELAY = 3000;  // 增加延迟

            for (let currentSlot = this.currentSlot; currentSlot <= latestSlot; currentSlot += BATCH_SIZE) {
                const batchEnd = Math.min(currentSlot + BATCH_SIZE - 1, latestSlot);
                console.log(`处理区块批次: ${currentSlot} 到 ${batchEnd}`);

                // 并行处理一批区块
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

                // 等待当前批次完成
                await Promise.all(promises);

                // 批次间延迟
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));

                // 更新进度
                if (currentSlot % 100 === 0) {
                    const progress = ((currentSlot - this.startSlot) / (latestSlot - this.startSlot) * 100).toFixed(2);
                    console.log(`处理进度: ${progress}%`);
                }
            }

            console.log('历史区块处理完成');
        } catch (error) {
            console.error('处理历史区块时发生错误:', error.message);
        }
    }

    async processNewSlot(slotInfo) {
        // 添加重试逻辑
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

                // 处理区块中的每笔交易
                for (const tx of block.transactions) {
                    try {
                        if (!tx.meta || tx.meta.err) continue;
                        if (!tx.transaction || !tx.transaction.message) continue;

                        const transaction = tx.transaction;
                        const message = transaction.message;
                        
                        // 检查必要的属性是否存在
                        if (!message.accountKeys || !message.instructions) {
                            if (this.debug) {
                                console.log('跳过不完整的交易数据');
                            }
                            continue;
                        }

                        // 获取所有程序ID
                        const programIds = new Set();
                        message.instructions.forEach(ix => {
                            if (ix.programIdIndex !== undefined) {
                                const programId = message.accountKeys[ix.programIdIndex];
                                if (programId) {
                                    programIds.add(programId.toBase58());
                                }
                            }
                        });

                        // 检查交易是否涉及我们监听的程序
                        const relevantPrograms = this.watchedPrograms.length === 0 
                            ? Array.from(programIds)
                            : Array.from(programIds).filter(programId => 
                                this.watchedPrograms.some(watchedId => 
                                    watchedId.toBase58() === programId
                                )
                            );

                        if (relevantPrograms.length > 0) {
                            // 解析交易详情
                            const txInfo = {
                                signature: transaction.signatures[0],
                                slot: slotInfo.slot,
                                blockTime: block.blockTime ? new Date(block.blockTime * 1000).toISOString() : null,
                                programs: relevantPrograms,
                                accounts: message.accountKeys.map(key => key.toBase58()),
                            };

                            // 安全地解析指令
                            const instructions = [];
                            for (const ix of message.instructions) {
                                try {
                                    if (ix.programIdIndex === undefined || !ix.accounts || !ix.data) continue;
                                    
                                    const programId = message.accountKeys[ix.programIdIndex];
                                    if (!programId) continue;

                                    const instruction = {
                                        programId: programId.toBase58(),
                                        accounts: ix.accounts.map(idx => {
                                            const account = message.accountKeys[idx];
                                            return account ? account.toBase58() : null;
                                        }).filter(account => account !== null),
                                        data: ix.data ? Buffer.from(ix.data).toString('hex') : '',
                                    };

                                    // 解析 Raydium 指令
                                    if (instruction.programId === 'CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW' && instruction.data) {
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
                                        console.error('解析指令时出错:', error.message);
                                    }
                                    continue;
                                }
                            }

                            // 只输出包含有效指令的交易
                            if (instructions.length > 0) {
                                console.log('Raydium 交易:', {
                                    ...txInfo,
                                    instructions,
                                    日志: tx.meta.logMessages || [],
                                });
                            }
                        }
                    } catch (error) {
                        if (this.debug) {
                            console.error('处理交易时出错:', error.message);
                        }
                        continue;
                    }
                }
            } catch (error) {
                if (error.message.includes('429')) {
                    // 如果是速率限制错误，等待后重试
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.log(`遇到速率限制，等待 ${delay}ms 后重试...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (!error.message.includes('Block not available')) {
                    console.error(`处理区块 ${slotInfo.slot} 时发生错误:`, error.message);
                }
                throw error;
            }
        }
    }
}

// 添加 Raydium 指令类型解析函数
function getRaydiumInstructionType(discriminator) {
    // Raydium 的一些常见指令类型
    const INSTRUCTION_TYPES = {
        '0b05a0b39c3cd8ea': 'swap',
        'f4c069a1b5f233bc': 'addLiquidity',
        '4a1c3df8fa781539': 'removeLiquidity',
        // 可以添加更多指令类型
    };

    return INSTRUCTION_TYPES[discriminator] || 'unknown';
}

// 启动索引服务
const indexer = new SolanaIndexer();
indexer.start();

// 添加更详细的错误处理
process.on('unhandledRejection', (error) => {
    console.error('未处理的 Promise 拒绝:', {
        错误: error.message,
        堆栈: error.stack
    });
});

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', {
        错误: error.message,
        堆栈: error.stack
    });
}); 