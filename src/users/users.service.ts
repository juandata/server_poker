import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  async onModuleInit() {
    try {
      await this.userModel.collection.dropIndex('name_1');
    } catch {
      // ignore if index does not exist
    }
  }

  async create(email: string, passwordHash: string, displayName?: string) {
    const user = new this.userModel({ email, passwordHash, displayName });
    return user.save();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email }).exec();
  }

  async findById(id: string) {
    return this.userModel.findById(id).exec();
  }
}
