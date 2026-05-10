import { IsNotEmpty, IsString } from 'class-validator';

export class RenameChainDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
