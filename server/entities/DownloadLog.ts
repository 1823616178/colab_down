import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'local' | 'vm'

@Entity('download_log')
@Index('idx_log', ['taskId', 'id'])
export class DownloadLog {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int' })
  taskId!: number

  @Column({ type: 'varchar', length: 8, default: 'info' })
  level!: LogLevel

  @Column({ type: 'varchar', length: 8, default: 'local' })
  source!: LogSource

  @Column({ type: 'text' })
  message!: string

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date
}
