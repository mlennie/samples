import Ember from 'ember';

export default Ember.ObjectController.extend({

	//check if reservations are more than 30 minutes after starting
	reservationHasPassed: function() {
		var date = new Date();
		return this.get('time').getTime() < (date.getTime() - 1800000);
	}.property(),

	//check if status is absent
	absent: function() {
		return this.get('status') === 'absent';
	}.property(),

	//check if status is cancelled
	cancelled: function() {
		return this.get('status') === 'cancelled';
	}.property(),

	//check if status is pending confirmation
	pendingConfirmation: function() {
		return this.get('status') === 'pending_confirmation';
	}.property('status'),

	validated: function() {
		return this.get('status') == 'validated';
	}.property('status'),

	reservationIsForFuture: function() {
		return this.get('reservationHasPassed') == false;
	}.property('reservationHasPassed'),

	date: function() {

		//add french months
		var months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", 
								  "Juillet", "Août", "Septembre", "Octobre", "Novembre", 
								  "Décembre"];

		//add french days
		var days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", 
								  "Dimanche"];

		var time = this.get('time');
		return days[time.getDay()] + ' ' +
					 time.getDate().toString() + ' ' + 
					 (months[time.getMonth()]) + ' ' +
					 time.getFullYear().toString();
	}.property(),

	hour: function() {
		var time = this.get('time');
		var secondMinuteDigit = time.getMinutes() < 10 ? '0' : '';
		return time.getHours().toString() + 
					 ':' + 
					 time.getMinutes().toString() +
					 secondMinuteDigit;
	}.property(),

	actions: {
		validateReservationAmount: function() {
			
			if (this.get('amount') === undefined) {
				alert('Please enter an amount.');
			} else {
				var confirmationText = "Are you sure you would like to validate " +
													"the reservation under the name " + 
													this.get('bookingName') +
													" for an amount of " +
													this.get('amount');
				var confirmationResponse = confirm(confirmationText);
				if (confirmationResponse == true) {
					var _this = this;

					//convert decimals to commas and commas to decimals 
					//so system can understand
					var amount = this.get('amount');

					formatAmount(amount, this);

					var onSuccess = function(reservation) {
					  _this.set('status', 'pending_confirmation');
					  alert('Update successful. Thank you!');
					};

					var onFail = function(reservation) {
					  alert('Sorry could not update reservation. Please Try again soon.');
					};

					this.get('model').save().then(onSuccess, onFail);
				} else {
					//they did not confirm so do nothing

				}

				function formatAmount(amount, controller) {
					
					//split amount into array based on commas and periods
					var commaArray = amount.split(',');
					var decimalArray = commaArray[0].split('.');

					//check if has decimal or comma
					if (commaArray.length === 1 && decimalArray.length === 1) {
						//treat normally
						//do nothing

					//check if has period
					} else if (decimalArray.length > 1) { //has period

						//get number of numbers after period
						var afterPeriodArray = decimalArray[1].split("");

						//check if period is french or english and continue as such
						if (afterPeriodArray.length < 3) { 
							//2 numbers after period so must be english

						} else { // 3 numbers after period so must be french
							//treat as french and set amount to be new reformatted amount
							controller.set('amount', reformatAsFrench(commaArray, decimalArray));
						}

					} else { //must have comma

						//get number of numbers after comma
						var afterCommaArray = commaArray[1].split("");

						//check if comma is french or english and continue as such
						if (afterCommaArray.length < 3) { 

							//has 2 numbers after comma so must be french
							//treat as french and set amount to be new reformatted amount
							controller.set('amount', reformatAsFrench(commaArray, decimalArray));

						} else {
							//has 3 numbers after comma so must be english
							//do nothing
						}
					}
				}

				function reformatAsFrench (commaArray, decimalArray) {
					//get cents if there's a comma
					if (commaArray.length == 2) {
						var cents = commaArray[1];
					} else {
						var cents = "00";
					}

					//get thousands if there's a decimal
					//and get euros
					
					if (decimalArray.length == 2) {
						var euros = decimalArray[0] + decimalArray[1];
					} else {
						var euros = decimalArray[0];
					}

					//set new formatted amount
					return euros + "." + cents;	
				}
			}
		}
	}
});
