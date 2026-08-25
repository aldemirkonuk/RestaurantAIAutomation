import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TokenCryptoService } from "./token-crypto.service";

@Module({
  imports: [ConfigModule],
  providers: [TokenCryptoService],
  exports: [TokenCryptoService],
})
export class CryptoModule {}
