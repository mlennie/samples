class Transaction < ActiveRecord::Base
  include Archiving
  
  belongs_to :concernable, polymorphic: true
  belongs_to :itemable, polymorphic: true
  belongs_to :wallet
  has_many :related_transactions

  enum kind: [ :reservation, :payment, :withdrawal, :referral, :promotion, 
               :adjustment ]
  
  def self.create_promotional_transaction user, promotion
    ActiveRecord::Base.transaction do 
        
      #build new transaction
      transaction = Transaction.new

      #set transaction amount
      transaction.amount = promotion.amount

      #set amount positive
      transaction.amount_positive = true

      #set transaction kind
      transaction.kind = "promotion"

      #add concernable to transaction
      transaction.concernable = user

      #set transaction itemable (promotion)
      transaction.itemable = promotion

      #set original_balance
      transaction.original_balance = get_original_balance user

      #set final amount
      transaction.final_balance = transaction.original_balance + promotion.amount

      #update user wallet balance
      user.wallet.update(balance: transaction.final_balance)

      #save transaction
      transaction.save
        
    end
  end

  #give money to person either being referred or person who did referring
  #referrer is the person who will receive the money
  def self.create_referral_transaction amount, referrer, user
    ActiveRecord::Base.transaction do 
        
      #build new transaction
      transaction = Transaction.new

      #set transaction amount
      transaction.amount = amount

      #set amount positive
      transaction.amount_positive = true

      #set transaction kind
      transaction.kind = "referral"

      #add concernable to transaction
      transaction.concernable = referrer

      #set transaction itemable (promotion)
      transaction.itemable = user

      #set original_balance
      transaction.original_balance = get_original_balance referrer

      #set final amount
      transaction.final_balance = transaction.original_balance + amount

      #update referrers wallet balance
      referrer.wallet.update(balance: transaction.final_balance)

      #save transaction
      transaction.save!
        
    end
  end

  def self.create_reservation_transaction(amount, discount, user_contribution, 
                              reservation, concernable)
  	ActiveRecord::Base.transaction do 
      #build new transaction 
      transaction = Transaction.new

      #add concernable to transaction
      transaction.concernable = concernable

      #add reservation to transaction
      transaction.itemable = reservation

      #set transaction kind
      transaction.kind = "reservation"

      #set transaction discount and user contribution
      transaction.discount = discount
      transaction.user_contribution = user_contribution

      #set original_balance
      original_balance = transaction.original_balance = get_original_balance concernable

      #set transaction amount
      transaction.amount = amount

      #set whether transaction is positive or not and update final balance
      if discount > 0 # if discount used
        transaction.amount_positive = (concernable.class.name == 'User') ? true : false
        if concernable.class.name == 'User'
        	transaction.final_balance = original_balance + amount * discount
        else
        	transaction.final_balance = original_balance - amount * discount
        end
      else # if user used their euros
        transaction.amount_positive = (concernable.class.name == 'User') ? false : true
        if concernable.class.name == 'User'
        	transaction.final_balance = original_balance - user_contribution
        else
        	transaction.final_balance = original_balance + user_contribution
        end
      end

      #update user wallet balance
      concernable.wallet.update(balance: transaction.final_balance)

      #save transaction
      transaction.save
      transaction
    end
  end

  def self.create_adjustable_transaction params, admin_id
    ActiveRecord::Base.transaction do 
      #get amount
      amount = params[:transaction][:amount].to_f

      #add reason presence validation
      return false if params[:transaction][:reason].empty?
      reason = params[:transaction][:reason]

      #get concernable (user or restaurant)
      if params[:user_id]
        concernable = User.find(params[:user_id])
      elsif params[:transaction][:concernable_id]
        concernable = Restaurant.find(params[:transaction][:concernable_id])
      end

      #build new transaction
      transaction = Transaction.new

      #set transaction amount
      transaction.amount = amount

      #set amoutn positive
      transaction.amount_positive = (amount > 0) ? true : false

      #add concernable to transaction
      transaction.concernable = concernable

      #set transaction kind
      transaction.kind = "adjustment"

      #set transaction reason
      transaction.reason = reason

      #set admin who made transaction
      transaction.admin_id = admin_id

      #set original_balance
      transaction.original_balance = get_original_balance concernable

      #set final amount
      transaction.final_balance = transaction.original_balance + amount

      #update user wallet balance
      concernable.wallet.update(balance: transaction.final_balance)

      #save transaction
      transaction.save
    end
  end

  private

    def self.get_original_balance concernable
      #add wallet if concernable doesn't have one already
      concernable.create_new_wallet unless concernable.wallet.present?
      #make balance 0 incase its nil
      concernable.wallet.update(balance: 0) if concernable.wallet.balance.blank?
      #set transaction original balance
      return concernable.wallet.balance
    end
end
