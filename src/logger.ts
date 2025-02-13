import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private static logDir = 'logs';
  private static ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir);
    }
  }

  private static writeLog(filename: string, data: any) {
    this.ensureLogDir();
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      ...data
    };
    
    // 格式化 JSON 输出
    fs.appendFileSync(
      path.join(this.logDir, filename),
      JSON.stringify(logEntry, null, 2) + '\n\n'  // 添加缩进和空行
    );
  }

  // 交易基础信息
  static logTransaction(data: any) {
    // 保留所有原始数据，并添加解析说明
    const formattedData = {
      // 基础信息
      signature: data.signature,
      slot: data.slot,
      blockTime: data.blockTime,
      
      // 程序和账户信息
      programs: data.programs,
      accounts: data.accounts.map((account: string, index: number) => ({
        index,
        address: account,
        // 为特殊账户添加说明
        description: account === 'CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW' ? 'Raydium Program' :
                    account === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ? 'Token Program' :
                    account === 'So11111111111111111111111111111111111111112' ? 'Wrapped SOL' :
                    account === '4QGCZU9vto49NwohfTLQd8JA6B49dacpMyNhfFB1W9We' ? 'USDC Mint' : undefined
      })),
      
      // 指令详情
      instructions: data.instructions.map((inst: any) => ({
        programId: inst.programId,
        type: inst.type || 'unknown',
        discriminator: inst.discriminator,
        accounts: inst.accounts,
        data: inst.data,
        // 为 swap 指令添加详细解释
        explanation: inst.type === 'swap' ? {
          description: 'Raydium Swap 指令',
          discriminator: `通过指令数据前8字节 (${inst.discriminator}) 识别为 swap 操作`,
          accountRoles: [
            { index: 0, role: '用户账户 (发起者)' },
            { index: 1, role: '流动性池状态账户' },
            { index: 2, role: '流动性池授权账户' },
            { index: 3, role: '流动性池基础代币账户' },
            { index: 4, role: '流动性池报价代币账户' },
            { index: 5, role: '用户基础代币账户' },
            { index: 6, role: '用户报价代币账户' },
            { index: 7, role: '流动性池Mint账户' },
            { index: 8, role: 'Token Program' },
            { index: 9, role: 'Token Program' },
            { index: 10, role: '基础代币Mint' },
            { index: 11, role: '报价代币Mint' }
          ]
        } : undefined
      })),

      // 完整的程序日志
      logs: data.日志,

      // 代币余额变化
      tokenBalances: {
        pre: data.meta?.preTokenBalances,
        post: data.meta?.postTokenBalances,
      },

      // 解析说明
      analysis: {
        swapIdentification: {
          title: 'Raydium swap 识别过程:',
          steps: [
            '1. 检查程序ID是否为 Raydium (CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW)',
            '2. 解析指令数据的前8字节作为 discriminator (8fbe5adac41e33de)',
            '3. 匹配已知的 swap discriminator',
            '4. 确认指令日志中包含 "Instruction: SwapBaseInput"',
            '5. 分析 TransferChecked 指令确认代币转移'
          ]
        },
        tokenBalanceTracking: {
          title: '代币余额变化追踪:',
          steps: [
            '1. 记录交易前所有代币账户余额 (preTokenBalances)',
            '2. 记录交易后所有代币账户余额 (postTokenBalances)',
            '3. 计算每个代币的净余额变化',
            '4. SOL -> USDC 的 swap 操作会看到:',
            '   - SOL 余额减少 (输入)',
            '   - USDC 余额增加 (输出)'
          ]
        }
      }
    };

    this.writeLog('transactions.log', {
      type: 'transaction',
      data: formattedData
    });
  }

  // Swap 操作详情
  static logSwap(data: any) {
    this.writeLog('swaps.log', {
      type: 'swap',
      data
    });
  }

  // 代币余额变化
  static logTokenBalances(data: any) {
    // 简化余额信息，只保留关键字段
    const simplifiedData = {
      pre: data.pre.map((balance: any) => ({
        mint: balance.mint,
        owner: balance.owner,
        amount: balance.uiTokenAmount.uiAmountString
      })),
      post: data.post.map((balance: any) => ({
        mint: balance.mint,
        owner: balance.owner,
        amount: balance.uiTokenAmount.uiAmountString
      })),
      relevantLogs: data.relevantLogs
    };

    this.writeLog('token_balances.log', {
      type: 'balance_change',
      data: simplifiedData
    });
  }

  // 指令信息
  static logInstruction(data: any) {
    // 只记录 swap 相关的指令
    if (data.type === 'swap') {
      this.writeLog('instructions.log', {
        type: 'instruction',
        data
      });
    }
  }

  // 调试信息
  static logDebug(data: any) {
    if (process.env.DEBUG === 'true') {
      this.writeLog('debug.log', {
        type: 'debug',
        data
      });
    }
  }
} 