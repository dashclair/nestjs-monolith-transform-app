import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('MAIL_HOST'),
      port: Number(this.configService.get('MAIL_PORT')),
      secure: this.configService.get('MAIL_SECURE') === 'true',
      auth: this.configService.get('MAIL_USER')
        ? {
            user: this.configService.get('MAIL_USER'),
            pass: this.configService.get('MAIL_PASSWORD'),
          }
        : undefined,
    });
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
  }): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.configService.get('MAIL_FROM'),
        ...options,
      });
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${options.to}`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }
}
