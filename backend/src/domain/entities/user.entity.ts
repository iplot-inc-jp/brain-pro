import { BaseEntity } from './base.entity';
import { Email } from '../value-objects';
import { ValidationError } from '../errors';

export interface CreateUserProps {
  email: string;
  password: string;
  name?: string | null;
}

export interface ReconstructUserProps {
  id: string;
  email: string;
  password: string;
  name: string | null;
  avatarUrl: string | null;
  isSuperAdmin?: boolean;
  googleId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ユーザーエンティティ
 * ビジネスルールをカプセル化
 */
export class User extends BaseEntity {
  private _email: Email;
  private _password: string;
  private _name: string | null;
  private _avatarUrl: string | null;
  private _isSuperAdmin: boolean;
  private _googleId: string | null;

  private constructor(
    id: string,
    email: Email,
    password: string,
    name: string | null,
    avatarUrl: string | null,
    isSuperAdmin: boolean,
    googleId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._email = email;
    this._password = password;
    this._name = name;
    this._avatarUrl = avatarUrl;
    this._isSuperAdmin = isSuperAdmin;
    this._googleId = googleId;
  }

  /**
   * 新規ユーザー作成
   * @param props 作成に必要なプロパティ
   * @param hashedPassword ハッシュ化済みパスワード（ドメインサービスで処理）
   * @param id 生成済みID（インフラで生成）
   */
  static create(props: CreateUserProps, hashedPassword: string, id: string): User {
    const email = Email.create(props.email);
    
    if (!hashedPassword) {
      throw new ValidationError('Password is required');
    }

    const name = props.name?.trim() || null;
    if (name && name.length > 100) {
      throw new ValidationError('Name must be at most 100 characters');
    }

    const now = new Date();
    return new User(id, email, hashedPassword, name, null, false, null, now, now);
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructUserProps): User {
    return new User(
      props.id,
      Email.reconstruct(props.email),
      props.password,
      props.name,
      props.avatarUrl,
      props.isSuperAdmin ?? false,
      props.googleId ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  /**
   * Google アカウントからユーザーを新規作成（パスワード未設定）。
   */
  static createWithGoogle(
    props: { email: string; name?: string | null; avatarUrl?: string | null; googleId: string },
    id: string,
  ): User {
    const email = Email.create(props.email);
    const name = props.name?.trim() || null;
    if (name && name.length > 100) {
      throw new ValidationError('Name must be at most 100 characters');
    }
    const now = new Date();
    return new User(id, email, '', name, props.avatarUrl ?? null, false, props.googleId, now, now);
  }

  // ========== ビジネスロジック ==========

  /**
   * 名前を変更
   */
  changeName(name: string | null): void {
    if (name && name.length > 100) {
      throw new ValidationError('Name must be at most 100 characters');
    }
    this._name = name?.trim() || null;
    this.touch();
  }

  /**
   * パスワードを変更
   */
  changePassword(hashedPassword: string): void {
    if (!hashedPassword) {
      throw new ValidationError('Password is required');
    }
    this._password = hashedPassword;
    this.touch();
  }

  /**
   * アバターURLを変更
   */
  changeAvatarUrl(url: string | null): void {
    if (url && url.length > 500) {
      throw new ValidationError('Avatar URL is too long');
    }
    this._avatarUrl = url;
    this.touch();
  }

  /**
   * Google アカウントを既存ユーザーに紐付ける。
   */
  linkGoogle(googleId: string): void {
    this._googleId = googleId;
    this.touch();
  }

  /**
   * 全体管理者（プラットフォーム管理者）に昇格
   */
  promoteToSuperAdmin(): void {
    this._isSuperAdmin = true;
    this.touch();
  }

  /**
   * 全体管理者フラグを設定
   */
  setSuperAdmin(value: boolean): void {
    this._isSuperAdmin = value;
    this.touch();
  }

  // ========== Getter ==========

  get email(): string {
    return this._email.value;
  }

  get emailVO(): Email {
    return this._email;
  }

  get password(): string {
    return this._password;
  }

  get name(): string | null {
    return this._name;
  }

  get avatarUrl(): string | null {
    return this._avatarUrl;
  }

  get isSuperAdmin(): boolean {
    return this._isSuperAdmin;
  }

  get googleId(): string | null {
    return this._googleId;
  }
}

