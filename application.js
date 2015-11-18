import Ember from 'ember';
import SearchMixin from '../mixins/search';
import CurrentUserMixin from '../mixins/current-user';

export default Ember.Controller.extend(
  //Mixins
  SearchMixin,
  CurrentUserMixin, {

  needs: "index",
  index: Ember.computed.alias("controllers.index"),

  showTopSearch: false,

  //decide whether to show small footer or not
  showSmallFooter: function() {
    var path = this.get('currentPath');
    if (path === 'index' || path === 'login' || path === 'register') {
      return true;
    } else {
      return false;
    }
  }.property('currentPath'),

	//computed properties
	showCookieMessage: function() {
		//get cookieAccepted cookie and if not there (cookies not accepted)
		//then show cookie message
    var cookie = this.get('cookie');
    var cookiesAccepted = cookie.getCookie('cookiesAccepted');
    return (cookiesAccepted === undefined) ? true : false ;
	}.property('currentPath'),

	//scroll to top of page on page change
	scrollToTop: function () {
    window.scrollTo(0, 0);
  }.observes('currentPath'),

  //get navbar class
  navbarClass: function() {
    if (this.get('currentPath') !== 'index') {
      return 'navbar-white';
    } else {
      return 'nav-item';
    }
  }.property('currentPath'),

  //get logo class
  logoClass: function() {
    if (this.get('currentPath') !== 'index') {
      return 'logo-black';
    } else {
      return 'logo-white';
    }
  }.property('currentPath'),

  //get nav collaps button class
  collapseButton: function() {
    if (this.get('currentPath') !== 'index') {
      return 'white-collapse-button';
    } 
  }.property('currentPath'),

  //get background color
  backgroundColor: function() {
    if (this.get('currentPath') === 'register' ||
        this.get('currentPath') === 'login') {
      return 'grey-background';
    } else {
      return 'white-background';
    }
  }.property('currentPath'),

  //whether to show top search bar or not
  setShowTopSearch: function() {
    
  }.observes('currentPath'),

  //actions
  actions: {

  	//close cookies message and add cookies accepted cookie to browser
  	//when user closes cookie message
  	closeAndAcceptCookies: function() {
  		var cookie = this.get('cookie');
	    cookie.setCookie('cookiesAccepted', true);
	    this.set('showCookieMessage', false);
  	},

    goToIndex: function() {
      this.set('name', null);
      this.set('cuisine', undefined);
      this.set('cuisineDisabled', false);
      this.transitionToRoute('index', { queryParams: {concept: null}});
      this.set('showTopSearch', false);
      this.set('date', undefined);
      this.get('index').setProperties({
        confirmation_success: null,
        confirmation_fail: null,
        already_logged_in: null
      });
      Ember.$(window).scrollTop(0);
    },

    scrollToConcept: function() {
      Ember.$(document).ready(
        Ember.$('html, body').animate({
            scrollTop: 520
        }, 750)
      )
    },

     //allow clicking of link with specific id to go to that part of page
    jumpToConcept : function(){
      //MIXPANEL: send concept link click event
      mixpanel.track('Connexion Link Click', { 
        'location': 'navbar',
        'page': this.get('currentPath')
      });

      //scroll to top if on index, if not go to index and scroll to top
      if (this.get('currentPath') === 'index') {
        this.send('scrollToConcept');
      } else {
        this.transitionToRoute('index', { queryParams: {concept: true}});
      }
    }
  }
});
