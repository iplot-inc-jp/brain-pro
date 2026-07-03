import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google ID トークン(credential)' })
  @IsString()
  idToken: string;

  @ApiPropertyOptional({ description: '同時に受理する招待トークン' })
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
