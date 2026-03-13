import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { User } from './userModel.js';

const CapitalShareTransaction = sequelize.define('CapitalShareTransaction', {
  memberId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'Users', key: 'id' },
  },
  addedById: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'Users', key: 'id' },
  },
  confirmedById: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'Users', key: 'id' },
  },
  confirmedAt: { type: DataTypes.DATE, allowNull: true },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paymentType: {
    type: DataTypes.ENUM('Cash', 'Bank Transfer', 'GCash', 'Check', 'Adjustment'),
    allowNull: false,
    defaultValue: 'Cash',
  },
  referenceNumber: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  status: {
    type: DataTypes.ENUM('Pending', 'Confirmed', 'Rejected'),
    allowNull: false,
    defaultValue: 'Pending',
  },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  timestamps: false,
});

CapitalShareTransaction.belongsTo(User, { foreignKey: 'memberId', as: 'member' });
CapitalShareTransaction.belongsTo(User, { foreignKey: 'addedById', as: 'addedBy' });
CapitalShareTransaction.belongsTo(User, { foreignKey: 'confirmedById', as: 'confirmedBy' });

export default CapitalShareTransaction;
