import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { User } from './userModel.js';

const Announcement = sequelize.define('Announcement', {
  title: { 
    type: DataTypes.STRING, 
    allowNull: false 
  },
  description: { 
    type: DataTypes.TEXT, 
    allowNull: false 
  },
  userId: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  imageUrl: { 
    type: DataTypes.STRING, 
    allowNull: true 
  },
  videoUrl: { 
    type: DataTypes.STRING, 
    allowNull: true 
  },
  fileUrl: { 
    type: DataTypes.STRING, 
    allowNull: true 
  },
  fileName: { 
    type: DataTypes.STRING, 
    allowNull: true 
  },
  isPinned: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false 
  },
  createdAt: { 
    type: DataTypes.DATE, 
    allowNull: false, 
    defaultValue: DataTypes.NOW 
  },
  updatedAt: { 
    type: DataTypes.DATE, 
    allowNull: true 
  }
}, {
  timestamps: false
});

// Define associations
Announcement.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Announcement, { foreignKey: 'userId' });

export default Announcement;
