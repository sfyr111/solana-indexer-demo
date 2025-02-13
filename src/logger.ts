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
    const formattedData = {
      timestamp: new Date().toISOString(),
      signature: data.signature,
      slot: data.slot,
      blockTime: data.blockTime,
      programs: data.programs,
      accounts: data.accounts,
      meta: {
        preTokenBalances: data.meta?.preTokenBalances,    
        postTokenBalances: data.meta?.postTokenBalances,  
        err: data.meta?.err,                             
        logMessages: data.meta?.logMessages,             
        status: data.meta?.status                        
      },
      instructions: data.instructions.map((inst: any) => ({
        programId: inst.programId,
        accounts: inst.accounts || [],
        data: inst.data,
        type: inst.type,
        discriminator: inst.discriminator
      })),
      logs: data.logs
    };

    this.writeLog('transactions.log', formattedData);
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

  // 记录区块交易信息
  static logBlockTransactions(data: any) {
    this.writeLog('block_transactions.log', {
      timestamp: new Date().toISOString(),
      slot: data.slot,
      blockTime: data.blockTime,
      transactions: data.transactions
    });
  }
} 