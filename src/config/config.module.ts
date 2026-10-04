import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_CONFIG, buildConfig } from './configuration';
import { validateEnv } from './env.validation';

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  providers: [{ provide: APP_CONFIG, useFactory: () => buildConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
