import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { bigintTransformer } from './transformers'

export type TaskSourceType = 'huggingface' | 'http' | 'github' | 'gdrive' | 'torrent'
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retry_wait'
export type DownloadMode = 'direct' | 'staged'

// 注意：所有装饰器必须显式声明 type —— Nitro/esbuild 不支持 emitDecoratorMetadata，无法反射推断类型
@Entity('task')
@Index('idx_sched', ['status', 'priority', 'id'])
@Index('idx_retry', ['status', 'nextRetryAt'])
@Index('idx_list', ['status', 'createdAt'])
@Index('idx_source', ['sourceType', 'createdAt'])
export class Task {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 255 })
  name!: string

  @Column({ type: 'varchar', length: 16 })
  sourceType!: TaskSourceType

  @Column({ type: 'text' })
  sourceUrl!: string

  /** HF 分支 / tag / commit，默认 main */
  @Column({ type: 'varchar', length: 128, default: 'main' })
  revision!: string

  /** JSON 数组字符串，如 ["*.safetensors"] */
  @Column({ type: 'text', nullable: true })
  allowPatterns!: string | null

  @Column({ type: 'text', nullable: true })
  ignorePatterns!: string | null

  /** Drive 相对路径（不含 drive_root 前缀） */
  @Column({ type: 'varchar', length: 512 })
  destPath!: string

  @Column({ type: 'varchar', length: 8, default: 'direct' })
  downloadMode!: DownloadMode

  /** 越小越先，默认 100 */
  @Column({ type: 'int', default: 100 })
  priority!: number

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: TaskStatus

  @Column({ type: 'boolean', default: false })
  cancelRequested!: boolean

  /** 0-100 */
  @Column({ type: 'int', default: 0 })
  progress!: number

  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  totalBytes!: number | null

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  downloadedBytes!: number

  /** 断点续传位点 */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  resumeOffset!: number

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  speedBps!: number

  @Column({ type: 'int', nullable: true })
  etaSec!: number | null

  @Column({ type: 'varchar', length: 512, nullable: true })
  currentFile!: string | null

  @Column({ type: 'int', default: 0 })
  fileTotal!: number

  @Column({ type: 'int', default: 0 })
  fileDone!: number

  /** 机器可读错误码，决定是否可重试 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null

  @Column({ type: 'text', nullable: true })
  errorMsg!: string | null

  @Column({ type: 'int', default: 0 })
  retryCount!: number

  @Column({ type: 'int', default: 3 })
  maxRetries!: number

  @Column({ type: 'datetime', nullable: true })
  nextRetryAt!: Date | null

  @Column({ type: 'int', nullable: true })
  vmId!: number | null

  @Column({ type: 'int', nullable: true })
  credentialId!: number | null

  /** 冗余存储，便于对账 */
  @Column({ type: 'varchar', length: 128, nullable: true })
  vmSessionName!: string | null

  /** out.log 已读偏移，断连恢复用 */
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  logOffset!: number

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @Column({ type: 'datetime', nullable: true })
  startedAt!: Date | null

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date

  @Column({ type: 'datetime', nullable: true })
  completedAt!: Date | null
}
