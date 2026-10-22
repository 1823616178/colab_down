import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

export type CredentialType = 'rclone_drive' | 'hf_token' | 'github_token' | 'other'

@Entity('credential')
@Index('uk_credential_name', ['name'], { unique: true })
export class Credential {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'varchar', length: 16 })
  type!: CredentialType

  /** AES-256-GCM 加密存储（base64: iv.tag.cipher） */
  @Column({ type: 'text' })
  valueEnc!: string

  /** 末 4 位，用于 UI 显示 */
  @Column({ type: 'varchar', length: 8 })
  hint!: string

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date
}
