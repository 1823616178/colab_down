import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import { bigintTransformer } from './transformers'

export type TaskFileStatus = 'pending' | 'downloading' | 'done' | 'failed'

@Entity('task_file')
@Index('idx_taskfile', ['taskId', 'id'])
export class TaskFile {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'int' })
  taskId!: number

  @Column({ type: 'varchar', length: 1024 })
  relPath!: string

  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  bytes!: number | null

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: TaskFileStatus

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum!: string | null

  @Column({ type: 'datetime', nullable: true })
  completedAt!: Date | null
}
