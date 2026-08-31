import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return a placeholder response', () => {
      expect(controller.login()).toEqual({ message: 'Not implemented yet' });
    });
  });

  describe('register', () => {
    it('should return a placeholder response', () => {
      expect(controller.register()).toEqual({ message: 'Not implemented yet' });
    });
  });
});
