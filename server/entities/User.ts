import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('user')
@Index('uk_user_username', ['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar', length: 64 })
  username!: string

  /** bcrypt hash */
  @Column({ type: 'varchar', length: 128 })
  passwordHash!: string

  @Column({ type: 'varchar', length: 64, default: '' })
  displayName!: string

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt!: Date | null
}
