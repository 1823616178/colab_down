import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export type RuntimeType = 'cpu' | 'T4' | 'L4' | 'G4' | 'H100' | 'A100' | 'v5e1' | 'v6e1'
export type VMStatus =
  | 'creating'
  | 'bootstrapping'
  | 'awaiting_drive_auth'
  | 'idle'
  | 'busy'
  | 'reconnecting'
  | 'draining'
  | 'stopping'
  | 'stopped'
  | 'error'
export type DriveBackend = 'colab_native' | 'rclone'
export type DriveAuthState =
  | 'none'
  | 'requesting'
  | 'awaiting_user'
  | 'propagating'
  | 'mounted'
  | 'lost'
  | 'timeout'
  | 'failed'

// 注意：所有装饰器必须显式声明 type —— Nitro/esbuild 不支持 emitDecoratorMetadata
@Entity('vm')
@Index('uk_session', ['sessionName'], { unique: true })
export class VM {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 128 })
  sessionName!: string

  @Column({ type: 'varchar', length: 8, default: 'cpu' })
  runtimeType!: RuntimeType

  @Column({ type: 'varchar', length: 24, default: 'creating' })
  status!: VMStatus

  /** 单槽：0 或 1 个任务 */
  @Column({ type: 'int', nullable: true })
  currentTaskId!: number | null

  /** 独立 CLI 状态文件（C13：并行调用隔离 sessions.json） */
  @Column({ type: 'varchar', length: 512 })
  configPath!: string

  @Column({ type: 'boolean', default: false })
  bootstrapped!: boolean

  @Column({ type: 'varchar', length: 16, default: 'colab_native' })
  driveBackend!: DriveBackend

  @Column({ type: 'boolean', default: false })
  driveMounted!: boolean

  /** 挂载点绝对路径，下发给 worker */
  @Column({ type: 'varchar', length: 512, nullable: true })
  driveRoot!: string | null

  @Column({ type: 'varchar', length: 16, default: 'none' })
  driveAuthState!: DriveAuthState

  @Column({ type: 'datetime', nullable: true })
  driveAuthorizedAt!: Date | null

  @Column({ type: 'boolean', default: true })
  autoStop!: boolean

  /** 秒，默认 3600（授权过的 VM 尽量留着复用） */
  @Column({ type: 'int', default: 3600 })
  idleTimeout!: number

  @Column({ type: 'text', nullable: true })
  errorMsg!: string | null

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @Column({ type: 'datetime', nullable: true })
  bootstrappedAt!: Date | null

  @UpdateDateColumn({ type: 'datetime' })
  lastActiveAt!: Date

  @Column({ type: 'datetime', nullable: true })
  lastHeartbeatAt!: Date | null

  /** created_at + 23h（C16：24h keep-alive 硬上限，留 1h 余量） */
  @Column({ type: 'datetime' })
  expiresAt!: Date
}
