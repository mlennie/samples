class Restaurant < ActiveRecord::Base
  include Archiving

  has_many :services
  has_many :reservations
  has_many :reservation_errors
  has_many :ratings
  belongs_to :user
  has_many :favorite_restaurants
  has_many :favorite_users, through: :favorite_restaurants, source: :users
  has_one :wallet, as: :concernable
  has_many :transactions, as: :concernable
  has_many :invoices
  has_many :restaurant_cuisines
  has_many :cuisines, through: :restaurant_cuisines
  has_many :menus
  has_many :service_templates

  #add geolocation and reverse geolocation
  geocoded_by :full_street_address
  after_validation :geocode, if: :full_street_address_changed?
  reverse_geocoded_by :latitude, :longitude do |obj,results|
    if geo = results.first
      obj.geocoded_address = geo.address 
    end
  end

  after_validation :reverse_geocode, if: :full_street_address_changed?

  after_save :create_new_wallet
  #add services after creation
  after_create :add_services_for_one_year_from_automation_template

  validates_presence_of :name, :principle_email

  def to_s
    unless name.blank? 
      name
    else
      email
    end
  end

  def full_street_address
    street + city + country + zipcode
  end

  #add year's worth of services for all restaurants 
  #if today is first day of month
  def self.add_services_for_restaurants_if_first_of_month
    date = Time.new
    if date.midnight == date.beginning_of_month
      puts "updating services..."
      Restaurant.add_services_for_one_year_for_all_restaurants
    else
      puts "no restaurants were added since it's not the first day of the month"
    end
  end

  #add one years worth of services for all restaurants
  def self.add_services_for_one_year_for_all_restaurants
    Restaurant.get_unarchived.all.each do |restaurant|
      restaurant.add_services_for_one_year_from_automation_template
    end
  end

  #add services for one year for restaurant
  def add_services_for_one_year_from_automation_template
    params = {}
    #set date and restaurant params
    date = Restaurant.turn_time_to_date_string Time.new
    
    params[:date] = Restaurant.get_date_from_string date
    params[:restaurant_id] = self.id

    #set service template id param
    params[:service_template_id] = self.get_automation_service_template_id

    Restaurant.use_template_to_create_services_for_12_months params
  end

  #format time to be string eg. "2015-04-15" from time object (eg.Time.new)
  def self.turn_time_to_date_string time
    timeString = time.to_s     
    timeArray = timeString.split("-") #eg. ["2015","04","15 14:49:25 +0200"]
    dayArray = timeArray[2].split(" ") #eg. "15"

    return timeArray[0].to_s + "-" + timeArray[1].to_s + "-" + dayArray[0].to_s
  end
  #get template id that will be used to automate service creation
  def get_automation_service_template_id
    template_id = nil

    #get template from restaruant templates if exists
    self.service_templates.get_unarchived.all.each do |template|
      template_id = template.id if template.use_for_automation
    end

    #if restaurant did not have any automation templates, 
    #get automation template id from master template
    unless template_id != nil
      template_id = ServiceTemplate.get_unarchived
                     .where(restaurant_id: nil)
                     .where(use_for_automation: true).first.id
    end

    return template_id
  end

  def self.use_template_to_create_services_for_12_months params
    original_date = params[:date]
    #12 months made too many services so I changed the amount to 3 below
    #to change back to twelve months, change 3 to 12
    3.times do |index|
      date = original_date + index.months
      params[:date] = date
      params[:whole_month] = true
      Restaurant.use_template_to_create_services params
    end
    return true
  end

  #turn string date eg "2015-4-7" into real date
  def self.get_date_from_string date
    #make date calculations
    array_date = date.split("-")
    year = array_date[0].to_i # eg. 2015
    month = array_date[1].to_i # eg. 4 (april)
    day = array_date[2].to_i # eg. 7 (7th day of month)
    return Date.new(year, month, day) #eg . Tue, 07 Apr 2015
  end

  def self.use_template_to_create_services params

    #get current date, service template and restaurant
    date = params[:date]
    service_template = ServiceTemplate.get_unarchived.find(params[:service_template_id].to_i)
    service_template_services = service_template.services.get_unarchived
    restaurant = Restaurant.get_unarchived.find(params[:restaurant_id].to_i)
    restaurant_services = restaurant.services.get_unarchived.today_or_future

    day_of_week = date.cwday # eg. 2 (tuesday)

    first_date_of_month = date.beginning_of_month #eg. Wed, 01 Apr 2015
    last_date_of_month = date.end_of_month #eg. Thu, 30 Apr 2015

    first_day_of_first_week_of_month = first_date_of_month.cwday # eg. 3 (wednesday)
    last_day_of_last_week_of_month = last_date_of_month.cwday #eg. 4 (thursday)

    #get date of first day of first week on calendar (evens if it's from last month)
    first_date_of_calendar = case first_day_of_first_week_of_month
      when 1
        first_date_of_month
      when 2
        first_date_of_month - 1.day
      when 3
        first_date_of_month - 2.days
      when 4
        first_date_of_month - 3.days
      when 5
        first_date_of_month - 4.days
      when 6
        first_date_of_month - 5.days
      when 7
        first_date_of_month - 6.days
    end

    #get number of weeks in calendar 
    first_week_of_calendar = first_date_of_calendar.cweek #eg 14
    last_week_of_calendar = last_date_of_month.cweek #eg 18
    number_of_weeks_in_month = last_week_of_calendar - first_week_of_calendar + 1 

    #get starting dates for each weeks in calendar
    #already have first: first_date_of_calendar
    second_week_of_calendar = first_date_of_calendar + 7.days
    third_week_of_calendar = second_week_of_calendar + 7.days
    fourth_week_of_calendar = third_week_of_calendar + 7.days
    fifth_week_of_calendar = fourth_week_of_calendar + 7.days
    if (number_of_weeks_in_month == 6)
      sixth_week_of_calendar = fifth_week_of_calendar + 7.days
    end

    #start a transaction so that if something fails,
    #database will be rolled back
    ActiveRecord::Base.transaction do
  
      if params[:week_one] || params[:whole_month]
        restaurant.create_services_for_week(
          first_date_of_calendar, 
          service_template_services,
          restaurant_services
        )
      end

      if params[:week_two] || params[:whole_month]
        restaurant.create_services_for_week(
          second_week_of_calendar,
          service_template_services,
          restaurant_services
        )
      end

      if params[:week_three] || params[:whole_month]
        restaurant.create_services_for_week(
          third_week_of_calendar,
          service_template_services,
          restaurant_services
        )
      end

      if params[:week_four] || params[:whole_month]
        restaurant.create_services_for_week(
          fourth_week_of_calendar,
          service_template_services,
          restaurant_services
        )
      end

      if params[:week_five] || params[:whole_month]
        restaurant.create_services_for_week(
          fifth_week_of_calendar,
          service_template_services,
          restaurant_services
        )
      end

      if (params[:week_six] || params[:whole_month]) && (number_of_weeks_in_month == 6)
        restaurant.create_services_for_week(
          sixth_week_of_calendar,
          service_template_services,
          restaurant_services
        )
      end
    end
    return true
  end

  def create_services_for_week(start_of_week_date, 
                               service_template_services, 
                               restaurant_services)

    #create services for restaurant from template
    service_template_services.all.each do |template_service|
      
      service_day = template_service.template_day

      template_date = case service_day
        when "Monday"
          start_of_week_date
        when "Tuesday" 
          start_of_week_date + 1.day
        when "Wednesday" 
          start_of_week_date + 2.days
        when "Thursday"
          start_of_week_date + 3.days
        when "Friday"
          start_of_week_date + 4.days
        when "Saturday"
          start_of_week_date + 5.days
        when "Sunday"
          start_of_week_date + 6.days
      end

      #get year, month and day
      service_year = template_date.year
      service_month = template_date.month
      service_day = template_date.day

      #start hour and minutes
      service_start_hour = template_service.start_time.hour
      service_start_minutes = template_service.start_time.min

      #last booking hour and minutes
      service_end_hour = template_service.last_booking_time.hour
      service_end_minutes = template_service.last_booking_time.min

      #create new start time date
      service_start_time = Time.zone.local(
        service_year,
        service_month,
        service_day,
        service_start_hour,
        service_start_minutes,
        0
      )

      #create new end time date
      service_last_booking_time = Time.zone.local(
        service_year,
        service_month,
        service_day,
        service_end_hour,
        service_end_minutes,
        0
      )
      
      #don't add services to days that already have services
      unless restaurant_services.services_within_time_period(
               service_start_time, 
               service_last_booking_time).any? ||
        service_last_booking_time < Time.new

        #create service for restaurant
        self.services.create({
          availabilities: template_service.availabilities,
          start_time: service_start_time,
          last_booking_time: service_last_booking_time,
          nb_10: template_service.nb_10,
          nb_15: template_service.nb_15,
          nb_20: template_service.nb_20,
          nb_25: template_service.nb_25
        })
        puts "created service for " + self.name + " from " + 
             service_start_time.to_s + " to " + service_last_booking_time.to_s +
             " from template id: " + template_service.service_template.id.to_s
      end
    end
  end

  def full_street_address_changed?
    if street == nil ||
      city == nil ||
      country == nil ||
      zipcode == nil
      return false
    else
      street_changed? || city_changed? || country_changed? || zipcode_changed?
    end
  end

  def billing_address
    return {
      company: billing_company,
      street: billing_street,
      city: billing_city,
      zipcode: billing_zipcode,
      country: billing_country
    }
  end

  def create_new_wallet
    Wallet.create_for_concernable self
  end

  #get invoice start date for when creating invoices
  def get_invoice_start_date
    #make sure restaurant is more than one month old
    if self.created_at > Time.new - 1.month
      return "Restaurant is less than one month old. Cannot create invoice"
    else  
      #get older invoices
      past_invoices = self.invoices.get_unarchived
      #check if has past paid invoices
      if past_invoices.where(paid: true).any?
        #check if last invoice was paid
        if past_invoices.last.paid?
          #start invoice from start of month after paid invoice
          start_date = (past_invoices.last.end_date.at_beginning_of_month + 1.month).to_date
        else 
          #not paid so start invoice from start of month after previously 
          #paid invoice (start building invoices as if last invoice, which 
          #wasn't paid, did not exist) (last unpaid invoice will be archived 
          #if this new invoice is created )
          last_paid_invoice = past_invoices.where(paid: true).last
          start_date = (last_paid_invoice.end_date.at_beginning_of_month + 1.month).to_date
        end
        #make sure there is at least a full month for the invoice
          if start_date >= Time.new.at_beginning_of_month.to_date 
            return "It has not been at least one month since the last paid invoice was sent"
          else
            return start_date
          end
      else
        #if doesn't have any paid invoices yet, get created at date
        return self.created_at.to_date
      end
    end
  end

  #get date params for second step of invoice creation
  def self.get_date_params params
    start_date = params[:invoice][:start_date]
    end_date = params[:invoice][:end_date]
    return { start_date: start_date, end_date: end_date }
  end

  #get invoice end date array for when creating invoices
  def get_invoice_end_date_array
    if self.created_at > Time.new - 1.month
      return ["Restaurant is less than one month old. Cannot create invoice"]
    else
      date_array = []
      start_date = self.get_invoice_start_date
      #get date of last day of last month
      last_month_end_date = Time.new.prev_month.end_of_month #eg: 2015-03-31 23:59:59 +0200
      #loop through months adding each one to array and then going back 
      #another month until reaching starting month
      current_date = last_month_end_date
      while current_date >= start_date
        date_array << current_date.end_of_month.to_date
        current_date -= 1.month 
        current_date = current_date.end_of_month
      end
      return date_array
    end
  end

  #archive all unpaid invoices
  def archive_unpaid_invoices new_invoice
    self.invoices.get_unarchived.where(paid: false).all.each do |invoice|
      invoice.archive unless new_invoice == invoice
    end
    return true
  end

  #calculate information for invoice
  def self.calculate_information_for_invoice params

    #get restaurant
    restaurant = Restaurant.find(params[:restaurant_id])
    percentage = restaurant.commission_percentage
    reservations = Reservation.get_for_invoice params

    #get total from all bills
    bill_total = 0
    reservations.all.each do |reservation|
      bill_total += reservation.bill_amount
    end

    #get end of month balance
    transaction = reservations.last.transactions.get_unarchived.where(concernable_type: "Restaurant").first
    final_balance = transaction.final_balance

    #create invoice object
    invoice = {} 
    invoice[:start_date] = params[:start_date].to_date
    invoice[:end_date] = params[:end_date].to_date
    invoice[:business_address] = restaurant.billing_address
    invoice[:client_number] = "A000" + restaurant.id.to_s
    invoice[:facture_number] = "A" + restaurant.id.to_s + '-' + (restaurant.invoices.get_unarchived.count + 1).to_s
    invoice[:pre_tax_owed] = bill_total * percentage
    invoice[:total_owed] =  invoice[:pre_tax_owed] * 1.2 
    invoice[:percentage] = percentage
    invoice[:formatted_percentage] = (percentage * 100).round.to_s + "%"
    invoice[:reservations] = reservations
    invoice[:final_balance] = final_balance
    invoice[:restaurant_id] = restaurant.id

    return invoice
  end

  def full_address
    street + ', ' + city + ', ' + zipcode
  end
end








