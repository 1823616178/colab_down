import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

export type SettingValueType = 'string' | 'int' | 'bool' | 'json'

@Entity('setting')
@Index('uk_setting_key', ['configKey'], { unique: true })
export class Setting {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  /** config_key 而非 key（KEY 是 MySQL 保留字） */
  @Column({ type: 'varchar', length: 128 })
  configKey!: string

  @Column({ type: 'text', nullable: true })
  value!: string | null

  @Column({ type: 'varchar', length: 8, default: 'string' })
  valueType!: SettingValueType

  @Column({ type: 'varchar', length: 512, nullable: true })
  description!: string | null

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date
}
